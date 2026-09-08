/*
 * SPDX-FileCopyrightText: 2025 Despair Games
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: flx-sta <https://github.com/flx-sta>
 * SPDX-FileContributor: NightKev <https://github.com/DayKev>
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { Logger, Plugin as VitePlugin } from "vite";

const NAME = "minify-public-json-files";
const VERSION = "3.0.0";

/** Patterns that should be excluded, meant to be excluded at any level */
const EXCLUDE_PATTERNS = ["REUSE.toml", ".git", "LICENSE", "README.md", "package.json", "pnpm-lock.yaml"];

function skipExcludes(file: string): boolean {
  for (const exclude of EXCLUDE_PATTERNS) {
    if (file.includes(exclude)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively applies custom-assets/ on top of an already-built output directory.
 *
 * Files under a top-level "locales" directory are merged (shallow, one level of JSON keys) into
 * the corresponding already-copied locale file rather than replacing it outright - a locale
 * namespace file like egg.json has many pre-existing keys from the upstream translations repo,
 * and a custom override should only be adding a few new ones, not deleting the rest. Every other
 * file (art, atlases, etc.) is copied over as a plain overwrite, since those are expected to be
 * complete, standalone files (see this plugin's own generateBundle for why a *shared* atlas like
 * items.png isn't a safe target for this - overriding it wholesale would drop every icon this
 * fork didn't touch).
 */
function applyCustomOverrides(srcDir: string, outDir: string, relPath = ""): void {
  const dirEntries = fs.readdirSync(path.join(srcDir, relPath));

  for (const entry of dirEntries) {
    if (skipExcludes(entry)) {
      continue;
    }
    const rel = path.join(relPath, entry);
    const fullPath = path.join(srcDir, rel);
    const outputFilePath = path.join(outDir, rel);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      fs.mkdirSync(outputFilePath, { recursive: true });
      applyCustomOverrides(srcDir, outDir, rel);
      continue;
    }

    const isLocaleFile = rel.split(path.sep)[0] === "locales" && entry.endsWith(".json");
    if (isLocaleFile) {
      let base: Record<string, unknown> = {};
      if (fs.existsSync(outputFilePath)) {
        try {
          base = JSON.parse(fs.readFileSync(outputFilePath, "utf-8"));
        } catch {
          // The already-copied file isn't valid JSON for some reason - fall back to just the
          // override content rather than failing the whole build over it.
        }
      }
      const overrides = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
      fs.writeFileSync(outputFilePath, JSON.stringify({ ...base, ...overrides }), "utf-8");
      continue;
    }

    fs.copyFileSync(fullPath, outputFilePath);
  }
}

/** Vite plugin to minify JSON files. Non-JSON files are copied as-is. */
export function minifyPublicJsonFiles(): VitePlugin {
  let logger: Logger;
  let count = 0;
  const errors: Error[] = [];
  const { cyan, gray, red, yellow, green } = chalk;

  return {
    name: NAME,
    version: VERSION,
    apply: "build",
    enforce: "post", // run after other plugins/stuff
    configResolved(resolvedConfig): void {
      logger = resolvedConfig.logger;
    },
    buildStart(): void {
      logger.info(cyan(`\t→ Plugin: ${NAME} v${VERSION}`));
    },
    async generateBundle(options): Promise<void> {
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: good enough
      const minifyJsonFiles = (dir: string, outDir: string): void => {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const fullPath = path.join(dir, file);
          const outputFilePath = path.join(outDir, file);
          const stat = fs.statSync(fullPath);

          if (skipExcludes(file)) {
            logger.info(yellow(`Skipping "${fullPath}".`));
            continue;
          }

          if (stat.isDirectory()) {
            logger.info(green(`Processing directory "${fullPath}".`));
            // Recurse into subdirectories
            const nestedOutputDir = path.join(outDir, file);
            fs.mkdirSync(nestedOutputDir, { recursive: true });
            minifyJsonFiles(fullPath, nestedOutputDir);
            continue;
          }
          if (file.endsWith(".json")) {
            try {
              // Minify JSON file
              const content = fs.readFileSync(fullPath, "utf-8");
              const minifiedContent = JSON.stringify(JSON.parse(content));
              fs.writeFileSync(outputFilePath, minifiedContent, "utf-8");
              count++;
            } catch (err) {
              fs.copyFileSync(fullPath, outputFilePath);
              const error = new Error(`Failed to minify JSON file: ${fullPath}\n\t→ ${err.message}`);
              error.stack = err.stack;
              errors.push(error);
            }
            continue;
          }
          // Copy other files as-is
          fs.copyFileSync(fullPath, outputFilePath);
        }
      };

      logger.info(cyan("\nBeginning JSON minification."));

      const assetsDir = path.resolve("./assets");
      const localesDir = path.resolve("./locales");
      const outputDir = path.resolve(options.dir || "dist");

      minifyJsonFiles(assetsDir, outputDir);
      minifyJsonFiles(localesDir, path.join(outputDir, "locales"));

      logger.info(cyan("JSON minification complete."));

      // assets/ and locales/ above are fetched fresh from their own upstream repositories on every
      // deploy (see .github/workflows/deploy-pages.yml) - anything committed directly into those
      // directories in THIS repo is discarded. custom-assets/, by contrast, IS part of this repo,
      // so it's the place for any of this fork's own custom art or translation additions. Mirrors
      // the same directory layout as the final output (custom-assets/images/... maps to
      // dist/images/..., custom-assets/locales/<lang>/<namespace>.json maps to
      // dist/locales/<lang>/<namespace>.json) and is applied last, after the copies above, so it
      // can add new files or override existing ones.
      const customAssetsDir = path.resolve("./custom-assets");
      if (fs.existsSync(customAssetsDir)) {
        logger.info(cyan("\nApplying custom-assets overrides."));
        applyCustomOverrides(customAssetsDir, outputDir);
        logger.info(cyan("custom-assets overrides applied."));
      }
    },
    closeBundle(): void {
      const logSuffix = gray(` [${NAME}]`);

      if (count > 0) {
        const failedMsg = errors.length > 0 ? yellow(` (${errors.length} failed)`) : "";

        logger.info(`${green(`✓ Minified ${count} JSON files successfully`)}${failedMsg}${logSuffix}`);
      }

      if (errors.length > 0) {
        errors.map(error => logger.error(`${red(error.message)}${logSuffix}`, { error }));
      }
    },
  };
}
