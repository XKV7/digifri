/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { Status } from "#data/status-effect";
import { BattleType } from "#enums/battle-type";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { EncounterPhase } from "#phases/encounter-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { generateStarters } from "#test/utils/game-manager-utils";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];

/**
 * Marks Dialga, Palkia, and Giratina as registered (caught) starters on the save - wave 800's
 * Adeus encounter is gated on all three being registered starters (see
 * GameMode#hasCreationTrioUnlocked), independently of whether any of them are actually part of
 * the run's own starting party.
 */
function registerCreationTrioStarters(game: GameManager): void {
  for (const species of [SpeciesId.DIALGA, SpeciesId.PALKIA, SpeciesId.GIRATINA]) {
    game.scene.gameData.dexData[species].caughtAttr = DexAttr.NON_SHINY;
  }
}

/**
 * Starts a fresh Nightmare-mode run at the given wave and waits for EncounterPhase to finish,
 * mirroring GameManager#runToFinalBossEncounter but stopping where a forced Mystery Encounter's
 * own MysteryEncounterPhase takes over, instead of waiting for CommandPhase (which a wild/trainer
 * battle would reach, but an ME's intro/option-select flow does not).
 */
async function runNightmareToWave(game: GameManager, wave: number): Promise<void> {
  game.override.startingWave(wave).disableTrainerWaves();
  await game.runToTitle();

  game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
    game.scene.gameMode = getGameMode(GameModes.NIGHTMARE);
    const starters = generateStarters(game.scene, defaultParty);
    const selectStarterPhase = new SelectStarterPhase();
    game.scene.phaseManager.pushPhase(new EncounterPhase(false));
    selectStarterPhase.initBattle(starters);
  });

  await game.phaseInterceptor.to("EncounterPhase");
}

/**
 * Fells the current enemy party and runs the resulting VictoryPhase, stopping right as
 * GameOverPhase becomes the next phase (without running it, to avoid its own UI flow).
 */
async function skipMysteryEncounterBattleToGameOver(game: GameManager): Promise<void> {
  game.scene.phaseManager.clearPhaseQueue();
  game.scene.getEnemyParty().forEach(p => {
    p.hp = 0;
    p.status = new Status(StatusEffect.FAINT);
    game.scene.field.remove(p);
  });
  game.scene.phaseManager.pushPhase(new VictoryPhase(0));
  game.endPhase();
  game.setMode(UiMode.MESSAGE);
  await game.phaseInterceptor.to("GameOverPhase", false);
}

describe("Nightmare (Hardcore) - forced final-wave encounters", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
  });

  it("forces the Adeus encounter at wave 800 when Dialga, Palkia, and Giratina are all registered starters", async () => {
    registerCreationTrioStarters(game);
    await runNightmareToWave(game, 800);

    expect(scene.currentBattle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
    expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.ADEUS_ENCOUNTER);
  });

  it("does not end the run after winning Adeus at wave 800", async () => {
    registerCreationTrioStarters(game);
    await runNightmareToWave(game, 800);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    // Should proceed to the normal ME rewards flow, not GameOverPhase - isWaveFinal(800) is false.
    await skipBattleRunMysteryEncounterRewardsPhase(game, false);
    expect(scene.currentBattle.battleType).not.toBe(BattleType.CLEAR);
  });

  it("forces the Arceus Trial encounter at wave 1000", async () => {
    await runNightmareToWave(game, 1000);

    expect(scene.currentBattle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
    expect(scene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.ARCEUS_TRIAL);
    // isClassicFinalBoss must stay false for ME battles (see battle.ts), or the Arceus Trial's own
    // intro/option-select UI gets hijacked by Eternatus-specific final boss dialogue routing.
    expect(scene.currentBattle.isClassicFinalBoss).toBe(false);
  });

  it("ends the run (game clear) after winning the Arceus Trial at wave 1000", async () => {
    await runNightmareToWave(game, 1000);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    const scoreBefore = scene.score;
    await skipMysteryEncounterBattleToGameOver(game);

    // handleMysteryEncounterVictory's final-wave branch sets these before queuing GameOverPhase.
    expect(scene.currentBattle.battleType).toBe(BattleType.CLEAR);
    expect(scene.score).toBeGreaterThan(scoreBefore);
    expect(game.isCurrentPhase("GameOverPhase")).toBe(true);
  });
});
