/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS, Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Species - Adeus", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.ADEUS)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  it("raises all 7 battle stats by 2 stages on switch-in via Singularity", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const adeus = game.field.getEnemyPokemon();
    expect(adeus).toHaveAbilityApplied(AbilityId.SINGULARITY);
    for (const stat of BATTLE_STATS) {
      expect(adeus.getStatStage(stat)).toBe(2);
    }
  });

  it("sets the Event Horizon field on switch-in via its passive", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeDefined();
  });

  it("traps both sides in battle while Event Horizon is up", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.BULBASAUR);

    const player = game.field.getPlayerPokemon();
    const adeus = game.field.getEnemyPokemon();
    expect(player.isTrapped()).toBe(true);
    expect(adeus.isTrapped()).toBe(true);
  });

  it("drops the Speed of a Pokemon entering the field by 1 stage while Event Horizon is active", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const tag = game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON);
    expect(tag).toBeDefined();

    const magikarp = game.field.getPlayerPokemon();
    expect(magikarp.getStatStage(Stat.SPD)).toBe(0);

    // Directly exercising the tag's own entry hook against the Pokemon already on the field, mirroring
    // what post-summon-phase.ts does for any Pokemon that's actually summoned - a real switch-in can't
    // be used here since both sides are trapped while Event Horizon is up (see the test above).
    // The phase it queues won't actually run until the turn advances, so select a move to drive it.
    tag!.apply(false, magikarp);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("StatStageChangePhase");

    expect(magikarp.getStatStage(Stat.SPD)).toBe(-1);
  });

  it("clears the Event Horizon field once Adeus leaves the field", async () => {
    game.override.moveset(MoveId.SHEER_COLD).ability(AbilityId.NO_GUARD).startingLevel(100).enemyLevel(1);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeDefined();

    game.move.select(MoveId.SHEER_COLD);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeUndefined();
  });
});
