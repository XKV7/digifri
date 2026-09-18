/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getDexNumber } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression coverage for Arceus#0 (SpeciesId.ARCEUS_ZERO) - a standalone Pokemon version of
 * Arceus's "true form" (see its own SpeciesId doc comment): visually reuses real Arceus's own
 * base sprite/icon/cry assets wholesale, and always benefits from the Legend Plate's auto-
 * retyping effect (see legend-plate.ts) without needing to actually hold one.
 */
describe("Arceus#0 (SpeciesId.ARCEUS_ZERO)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.JUDGMENT])
      .ability(AbilityId.MULTITYPE)
      .battleStyle("single")
      .criticalHits(false)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("is not catchable through normal gameplay", () => {
    expect(speciesDataRegistry.getSpecies(SpeciesId.ARCEUS_ZERO).isCatchable()).toBe(false);
  });

  it("shows its own raw id as its dex number rather than colliding with a real species", () => {
    expect(getDexNumber(SpeciesId.ARCEUS_ZERO)).toBe(SpeciesId.ARCEUS_ZERO);
  });

  it("always reuses real Arceus's own base sprite/icon regardless of its own current form", () => {
    const species = speciesDataRegistry.getSpecies(SpeciesId.ARCEUS_ZERO);
    expect(species.getBaseSpriteKey(false, 0)).toBe(`${SpeciesId.ARCEUS}-normal`);
    // Even for a non-Normal form index (as it retypes into during battle - see the test below),
    // the sprite key must stay fixed on Arceus's base "normal" art.
    expect(species.getBaseSpriteKey(false, 12)).toBe(`${SpeciesId.ARCEUS}-normal`);
    expect(species.getIconId(false, 5)).toBe(`${SpeciesId.ARCEUS}-normal`);
  });

  it("retypes on Judgment without holding any item, unlike a real Arceus", async () => {
    // Water is weak to both Grass (11) and Electric (12) at 2x - Grass should win the tie, same
    // matchup judgment.test.ts uses for a real held-Legend-Plate Arceus.
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.ARCEUS_ZERO);

    const arceusZero = game.field.getPlayerPokemon();
    expect(arceusZero.getFormKey()).toBe("normal");

    game.move.select(MoveId.JUDGMENT);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(game.phaseInterceptor.log.includes("LegendPlateFormChangePhase")).toBe(true);
    expect(arceusZero.getFormKey()).toBe("grass");
    expect(arceusZero.getTypes()).toStrictEqual([PokemonType.GRASS]);
    // Its sprite must stay fixed on Arceus's base art even after actually retyping in battle.
    expect(arceusZero.getSpriteId(false)).toContain(`${SpeciesId.ARCEUS}-normal`);
  });
});
