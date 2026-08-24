<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

<div align="center"><picture><img src="https://github.com/pagefaultgames/pokerogue-assets/blob/beta/images/logo.png?raw=true" width="300" alt="PokéRogue"></picture>

[![Discord Static Badge](https://img.shields.io/badge/Community_Discord-blurple?style=flat&logo=discord&logoSize=auto&labelColor=white&color=5865F2)](https://discord.gg/pokerogue)
[![Test Coverage Endpoint Badge](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Bertie690/9cdfc49361824d1d5a57b7e8b38855d8/raw/coverage-badge.json)](https://github.com/pagefaultgames/pokerogue/actions/workflows/tests.yml) \
[![Docs Coverage Static Badge](https://pagefaultgames.github.io/pokerogue/beta/coverage.svg)](https://pagefaultgames.github.io/pokerogue/beta)
[![Biome Linting Static Badge](https://img.shields.io/badge/Linted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)
[![GNU AGPLv3 License Static Badge](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
</div>

PokéRogue is a browser based Pokémon fangame heavily inspired by the roguelite genre. Battle endlessly while gathering stacking items, exploring many different biomes, fighting trainers, bosses, and more!

# 🚀 GitHub Pages Deployment (this fork)

This fork is configured to run **fully offline in the browser** (no login server required):

- `VITE_BYPASS_LOGIN=1` is set for production builds, so all save data is stored in the browser's `localStorage` (guest mode).
- The workflow in [`.github/workflows/deploy-pages.yml`](./.github/workflows/deploy-pages.yml) builds the game and deploys it to **GitHub Pages** on every push. Game assets and translations are fetched from the upstream `pokerogue-assets` / `pokerogue-locales` repositories at build time, so they are not committed here.

To enable it: push this repository to GitHub, then go to **Settings → Pages** and set the source to **GitHub Actions** (the workflow also attempts to enable this automatically). After the workflow finishes, the game is playable at `https://<owner>.github.io/<repo>/`.

**▶ Play now: <https://xkv7.github.io/digifri/>** (the address is case-sensitive — all lowercase, and the trailing `/digifri/` path is required.)

> ⚠️ Saves live in your browser's `localStorage` — clearing site data deletes your progress. Use the in-game menu's data export/import to back up saves.

## ☁️ Cloud save (cross-device continue) via Firebase

On top of the offline mode above, [`src/cloud-save.ts`](./src/cloud-save.ts) adds an optional layer: signing in with a Google account mirrors the same save keys to Firestore, so progress can continue on any device/browser signed into that account. Declining sign-in (or dismissing the prompt) keeps the game exactly as before — device-local only.

- On first load, a small overlay offers **"Google 계정으로 로그인"** (enable cloud save) or **"이 기기에서만 플레이"** (stay local-only). The choice is remembered; a `☁️` badge in the corner shows sync status and can be clicked to sign in/out later.
- Sync is last-write-wins per save key, using a client timestamp; if a device has unsynced local progress when first signing in on it, you're asked which copy to keep.
- The Firebase project this points to (`pokerogue-4818a`) is owned by the repo maintainer. To point this fork at your **own** Firebase project instead:
  1. Create a project at the [Firebase console](https://console.firebase.google.com), enable **Authentication → Sign-in method → Google**, add your Pages domain (e.g. `<owner>.github.io`) under **Authentication → Settings → Authorized domains**, and create a **Firestore Database**.
  2. Publish [`firestore.rules`](./firestore.rules) under **Firestore Database → Rules** — it restricts each save to its own signed-in user.
  3. Replace the `firebaseConfig` object at the top of `src/cloud-save.ts` with your project's web app config (Project settings → General → Your apps).
- The Firebase config values are public client identifiers (not secrets) — safe to commit; access control is enforced by `firestore.rules` alone.

# Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md), this includes instructions on how to set up the game locally.

# 📝 Credits

> If this project contains assets you have produced and you do not see your name, **please** reach out, either [here on GitHub](https://github.com/pagefaultgames/pokerogue/issues/new) or via [Discord](https://discord.gg/pokerogue).

Thank you to all the wonderful people that have contributed to the PokéRogue project! You can find the credits [here](./CREDITS.md).

# Licensing

This repository seeks to be [REUSE compliant](https://reuse.software/): copyright and/or licensing information for each file is stored
either in the file itself or in an associated `REUSE.toml` file.

The full licensing information for each file can be found by utilizing [REUSE's tooling](https://github.com/fsfe/reuse-tool), such as via `reuse spdx`. \
An abbreviated summary of said information is as follows:
- All source code belonging to the project, unless otherwise noted, is licensed under [AGPL-v3.0-only](LICENSES/AGPL-3.0-only.txt).
- All forms of documentation (both Markdown files[^1] and any comments explicitly documenting source code) are licensed under [CC-BY-NC-SA-4.0](LICENSES/CC-BY-NC-SA-4.0.txt).
- Auto-generated files produced by external tools or files of insignificant originality are not copyrighted and are licensed under [CC0-1.0](LICENSES/CC0-1.0.txt).
- To the extent that the assets we provide are [licensable and applicable](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en#ref-exception-or-limitation), they are licensed under [CC-BY-NC-SA-4.0](LICENSES/CC-BY-NC-SA-4.0.txt) unless otherwise noted.
  Exceptions can be found in associated `REUSE.toml` files.
  - ⚠️ Files in `assets/` that are not explicitly licensed via `REUSE.toml` files should be considered to have _no_ licensing / copyright information.

[^1]: Including this README
