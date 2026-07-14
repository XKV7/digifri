import { initializeManifest } from "#app/global-manifest";

try {
  // Relative path so this works when hosted under a sub-path (e.g. GitHub Pages)
  const manifest = await fetch("./manifest.json").then(r => r.json());
  initializeManifest(manifest["manifest"]);
} catch (err) {
  // Manifest not found (likely local build or path error on live)
  // TODO: Do we want actual error handling here?
  console.log("Manifest not found:", err);
}
