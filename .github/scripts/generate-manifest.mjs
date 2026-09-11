/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Generates dist/manifest.json - a map of every file's URL path (relative to dist/) to a short
// content hash, consumed by src/global-manifest.ts + src/utils/fetch-utils.ts#getCachedUrl to
// append a `?t=<hash>` cache-busting query param to asset/locale/font requests. Without this (a
// previous deploy step just wrote an empty `{"manifest":{}}` stub), every request goes out as a
// bare URL with no cache-busting at all, so a browser that had ever cached (including a cached
// 404 for a file that didn't exist yet in an earlier deploy) can keep serving that stale response
// indefinitely across later deploys - this is what caused newly-added locale files to intermittently
// fail to load for returning players.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const distDir = process.argv[2] ?? "dist";
const manifest = {};

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry === "manifest.json") {
      continue;
    }
    const relPath = `/${relative(distDir, fullPath).split(sep).join("/")}`;
    manifest[relPath] = createHash("md5").update(readFileSync(fullPath)).digest("hex").slice(0, 12);
  }
}

walk(distDir);
writeFileSync(join(distDir, "manifest.json"), JSON.stringify({ manifest }));
console.log(`Generated manifest.json with ${Object.keys(manifest).length} entries.`);
