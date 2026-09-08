# custom-assets

`assets/` and `locales/` are fetched fresh from their own upstream repositories
(`pagefaultgames/pokerogue-assets` and `pagefaultgames/pokerogue-locales`) on every
deploy — see `.github/workflows/deploy-pages.yml`. Anything added or edited directly
inside those two directories in this repo is silently discarded on the next build.

This directory is the place for this fork's own custom art or translation additions
instead. It's applied on top of the fetched `assets/`/`locales/` at build time (see
`plugins/vite/vite-minify-json-plugin.ts`), using the exact same layout as the final
build output:

- `custom-assets/images/...` → `dist/images/...` (same as `assets/images/...`)
- `custom-assets/locales/<lang>/<namespace>.json` → `dist/locales/<lang>/<namespace>.json`

**Images and other non-JSON files** are copied as a plain overwrite — safe for a
standalone file (a new sprite, a new atlas pair that isn't shared with anything else),
but do **not** use this for a *shared* atlas like `images/items.png`/`items.json` — a
full-file overwrite would silently drop every icon this fork didn't intend to touch.
Adding to a shared atlas needs the atlas file itself edited with a texture-packer tool
(most simply, by maintaining a fork of `pokerogue-assets` and repointing this repo's
deploy workflow at it).

**Locale JSON files** are merged (shallow, top-level keys only) into the
already-copied file from the real translations repo, rather than replacing it —
so a `custom-assets/locales/ko/egg.json` containing only the couple of new keys this
fork added is enough; it doesn't need to repeat every existing key from the real
`egg.json` to avoid losing them.
