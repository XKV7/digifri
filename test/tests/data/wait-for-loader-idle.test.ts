/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { waitForLoaderIdle } from "#data/pokemon-species";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for waitForLoaderIdle() (pokemon-species.ts), the fix for a real bug where a
 * species' battle sprite - Ingingi's, concretely, right after an egg hatch - could get stuck on
 * the "pkmn__sub" Substitute-doll placeholder every preview/reveal sprite starts as, instead of
 * ever swapping to its real sprite. Root cause: Pokemon#loadAssets() (field/pokemon.ts) used to
 * queue a species' atlas file into the shared Phaser loader with no regard for whether the loader
 * was already mid-batch on something unrelated - a file queued at exactly that moment can be
 * silently stranded (never actually fetched, no LOADER_COMPLETE ever fires for it) until something
 * else happens to pump the loader again, which may never happen before the reveal sprite tries to
 * `.play()` a sprite key whose animation was consequently never created. This was already a known,
 * already-fixed-once risk in PokemonSpeciesForm#loadAssets() itself (see its own `startLoad`
 * branch) - this function factors that exact fix out so Pokemon#loadAssets() can opt into it too
 * (see its own `waitForIdleLoader` param), which egg-hatch-phase.ts now does.
 */
describe("waitForLoaderIdle", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // GameManager's constructor sets up globalScene as a side effect - required here even though
    // the resulting instance itself is never referenced below.
    new GameManager(phaserGame);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves immediately without waiting on any loader event when the loader isn't currently loading anything", async () => {
    vi.spyOn(globalScene.load, "isLoading").mockReturnValue(false);
    const onceSpy = vi.spyOn(globalScene.load, "once");

    await waitForLoaderIdle();

    expect(onceSpy).not.toHaveBeenCalled();
  });

  it("registers a listener for the loader's own COMPLETE event (rather than resolving immediately) when the loader is mid-batch, and resolves once it fires", async () => {
    vi.spyOn(globalScene.load, "isLoading").mockReturnValue(true);
    // Mocked outright (not just spied-on) rather than relying on the test scene's loader to be a
    // fully functional EventEmitter - grabbing and directly invoking the registered callback below
    // simulates the COMPLETE event firing without needing that.
    const onceSpy = vi.spyOn(globalScene.load, "once").mockImplementation(() => globalScene.load);

    const promise = waitForLoaderIdle();

    expect(onceSpy).toHaveBeenCalledWith(Phaser.Loader.Events.COMPLETE, expect.any(Function));
    const completeCallback = onceSpy.mock.calls[0][1] as () => void;
    completeCallback();

    await expect(promise).resolves.toBeUndefined();
  });
});
