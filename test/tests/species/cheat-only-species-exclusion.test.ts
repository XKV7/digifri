/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { getRandomSpeciesByStarterCost } from "#mystery-encounters/encounter-pokemon-utils";
import { GameManager } from "#test/framework/game-manager";
import { initSceneWithoutEncounterPhase } from "#test/utils/game-manager-utils";
import { CHEAT_ONLY_SPECIES_IDS } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression coverage for a class of bug where this fork's own non-canon, cheat-only species
 * (MissingNo./Adeus/Ingingi - see CHEAT_ONLY_SPECIES_IDS's own doc comment) leaked into ordinary
 * gameplay through systems that iterate "all species"/"all starters" without excluding them:
 * - MissingNo. (baseTotal 900, every stat 150) could be rolled as an ordinary trainer's party
 *   member (e.g. any Ace Trainer, which has no curated speciesPools) or as an enemy fusion half,
 *   both via PokemonSpecies#isCatchable() not blocking it.
 * - Ingingi (EggTier.LEGENDARY, starterCost 3) could be hatched from an ordinary Legendary-tier
 *   egg through the normal weighted species pool, directly contradicting its own doc comment that
 *   it's never obtainable through any normal gameplay path at all.
 * - MissingNo./Adeus could be offered as Safari Zone/Pokemon Salesman/Dark Deal boss species via
 *   getRandomSpeciesByStarterCost(), which returns "any" species matching a cost range with no
 *   inherent exclusion of them.
 */
describe("Cheat-only species (MissingNo./Adeus/Ingingi) exclusion from normal gameplay systems", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    initSceneWithoutEncounterPhase(game.scene, [SpeciesId.MAGIKARP]);
  });

  it("PokemonSpecies#isCatchable() returns false for all three, so they never appear as an ordinary trainer party member/enemy fusion/wild fallback roll", () => {
    for (const speciesId of CHEAT_ONLY_SPECIES_IDS) {
      expect(speciesDataRegistry.getSpecies(speciesId).isCatchable()).toBe(false);
    }
  });

  it("SpeciesDataRegistry#getSpeciesForEggTier(LEGENDARY) excludes Adeus and Ingingi, even though Ingingi's own species data is tagged EggTier.LEGENDARY", () => {
    const legendaryPool = speciesDataRegistry.getSpeciesForEggTier(EggTier.LEGENDARY).map(s => s.speciesId);
    expect(legendaryPool).not.toContain(SpeciesId.ADEUS);
    expect(legendaryPool).not.toContain(SpeciesId.INGINGI);
  });

  it("getRandomSpeciesByStarterCost() never returns a cheat-only species even at exactly their own starter cost", () => {
    // MissingNo.=1, Ingingi=3, Adeus=10 - each queried at its own exact cost, where it would
    // otherwise be a directly in-range candidate.
    for (const cost of [1, 3, 10]) {
      for (let i = 0; i < 25; i++) {
        const result = getRandomSpeciesByStarterCost(cost);
        expect(CHEAT_ONLY_SPECIES_IDS).not.toContain(result);
      }
    }
  });

  it("getRandomSpeciesByStarterCost() still returns a valid species when queried across the full range (regression guard)", () => {
    const result = getRandomSpeciesByStarterCost([0, 10]);
    expect(speciesDataRegistry.getSpecies(result)).toBeDefined();
  });
});
