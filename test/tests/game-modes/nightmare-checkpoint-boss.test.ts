/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Nightmare (Hardcore) - Eternatus checkpoints", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.startingBiome(BiomeId.END).criticalHits(false).enemyMoveset(MoveId.SPLASH).startingLevel(10000);
  });

  it.each([
    200, 400, 600, 800,
  ])("spawns a regular-form Eternatus in a single (non-Eternamax) battle on checkpoint wave %i", async wave => {
    game.override.startingWave(wave);
    await game.runToFinalBossEncounter([SpeciesId.BIDOOF], GameModes.NIGHTMARE);

    expect(game.scene.currentBattle.waveIndex).toBe(wave);
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    expect(game.field.getEnemyPokemon().species.speciesId).toBe(SpeciesId.ETERNATUS);
    expect(game.field.getEnemyPokemon().formIndex).toBe(0);
    // isClassicFinalBoss gates the Eternamax phase-two transform (see damage-anim-phase.ts /
    // post-turn-status-effect-phase.ts) - it must stay false on checkpoints so the fight never
    // escalates into the true final boss experience.
    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(false);
    expect(game.scene.currentBattle.double).toBe(false);
  });

  it("spawns Eternatus as the true, Eternamax-capable final boss on wave 1000", async () => {
    game.override.startingWave(1000);
    await game.runToFinalBossEncounter([SpeciesId.BIDOOF], GameModes.NIGHTMARE);

    expect(game.scene.currentBattle.waveIndex).toBe(1000);
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    expect(game.field.getEnemyPokemon().species.speciesId).toBe(SpeciesId.ETERNATUS);
    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
  });

  it("does NOT treat non-multiples-of-200 waves as checkpoints", () => {
    const nightmareGameMode = game.scene.gameMode;
    nightmareGameMode.modeId = GameModes.NIGHTMARE;
    expect(nightmareGameMode.isNightmareCheckpointBoss(199)).toBe(false);
    expect(nightmareGameMode.isNightmareCheckpointBoss(201)).toBe(false);
  });
});
