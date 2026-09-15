/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BiomeId } from "#enums/biome-id";
import { DexAttr } from "#enums/dex-attr";
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
    200, 400,
  ])("spawns a regular-form Eternatus in a single (non-Eternamax) battle on checkpoint wave %i", async wave => {
    game.override.startingWave(wave);
    await game.runToFinalBossEncounter([SpeciesId.BIDOOF], GameModes.NIGHTMARE);

    expect(game.scene.currentBattle.waveIndex).toBe(wave);
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    expect(game.field.getEnemyPokemon().species.speciesId).toBe(SpeciesId.ETERNATUS);
    expect(game.field.getEnemyPokemon().formIndex).toBe(0);
    // isClassicFinalBoss gates the Eternamax phase-two transform (see damage-anim-phase.ts /
    // post-turn-status-effect-phase.ts) - it must stay false on 200/400 so the fight never
    // escalates past phase one.
    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(false);
    expect(game.scene.currentBattle.double).toBe(false);
  });

  it("allows the checkpoint Eternatus to reach its second (Eternamax) phase on wave 600, without ending the run", async () => {
    game.override.startingWave(600);
    await game.runToFinalBossEncounter([SpeciesId.BIDOOF], GameModes.NIGHTMARE);

    expect(game.scene.currentBattle.waveIndex).toBe(600);
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    expect(game.field.getEnemyPokemon().species.speciesId).toBe(SpeciesId.ETERNATUS);
    expect(game.field.getEnemyPokemon().formIndex).toBe(0);
    // Wave 600 gets the same isClassicFinalBoss-gated mechanics as the true final boss
    // (guaranteed phase-two transform, double battle switch-in, etc.)...
    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
    // ...but isWaveFinal must stay false, since this checkpoint must NOT end the run.
    expect(game.scene.gameMode.isWaveFinal(600)).toBe(false);
  });

  it("also falls back to the checkpoint Eternatus at wave 800 (with its own Eternamax phase two) when Dialga/Palkia/Giratina aren't all registered starters", async () => {
    game.override.startingWave(800);
    await game.runToFinalBossEncounter([SpeciesId.BIDOOF], GameModes.NIGHTMARE);

    expect(game.scene.currentBattle.waveIndex).toBe(800);
    expect(game.scene.arena.biomeId).toBe(BiomeId.END);
    expect(game.field.getEnemyPokemon().species.speciesId).toBe(SpeciesId.ETERNATUS);
    expect(game.field.getEnemyPokemon().formIndex).toBe(0);
    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
    expect(game.scene.gameMode.isWaveFinal(800)).toBe(false);
  });

  it("does NOT treat non-checkpoint waves as Eternatus checkpoints", () => {
    const nightmareGameMode = game.scene.gameMode;
    nightmareGameMode.modeId = GameModes.NIGHTMARE;
    expect(nightmareGameMode.isNightmareCheckpointBoss(199)).toBe(false);
    expect(nightmareGameMode.isNightmareCheckpointBoss(201)).toBe(false);
    expect(nightmareGameMode.isNightmareCheckpointBoss(1000)).toBe(false);
  });

  it("treats wave 800 as an Eternatus checkpoint only when Dialga, Palkia or Giratina isn't a registered starter", () => {
    const nightmareGameMode = game.scene.gameMode;
    nightmareGameMode.modeId = GameModes.NIGHTMARE;

    // Fresh save, none of the trio caught yet - hasCreationTrioUnlocked() is false, so wave 800
    // falls back to being a checkpoint just like wave 600.
    expect(nightmareGameMode.isNightmareCheckpointBoss(800)).toBe(true);

    for (const species of [SpeciesId.DIALGA, SpeciesId.PALKIA, SpeciesId.GIRATINA]) {
      game.scene.gameData.dexData[species].caughtAttr = DexAttr.NON_SHINY;
    }
    expect(nightmareGameMode.isNightmareCheckpointBoss(800)).toBe(false);
  });
});
