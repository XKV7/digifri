/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { Unlockables } from "#enums/unlockables";
import { ArceusTrialEncounter, initArceusTrialPhaseTwo } from "#mystery-encounters/arceus-trial-encounter";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const namespace = "mysteryEncounters/arceusTrial";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultWave = 45;

describe("Arceus Trial - Mystery Encounter", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .disableTrainerWaves()
      .moveset([MoveId.SPLASH, MoveId.SEISMIC_TOSS])
      .ability(AbilityId.BALL_FETCH)
      // Not overriding the enemy's ability - Arceus's own Multitype is required by the True Form
      // SpeciesFormChange's own condition (see generation-04.ts).
      .enemyLevel(1)
      .criticalHits(false);
  });

  it("should have the correct properties", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCEUS_TRIAL, defaultParty);

    expect(ArceusTrialEncounter.encounterType).toBe(MysteryEncounterType.ARCEUS_TRIAL);
    expect(ArceusTrialEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
    expect(ArceusTrialEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
    expect(ArceusTrialEncounter.options.length).toBe(2);
  });

  it("should leave without battling on option 2", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCEUS_TRIAL, defaultParty);
    await runMysteryEncounterToEnd(game, 2);

    expect(scene.getEnemyField().length).toBe(0);
  });

  it("should start a battle against a Normal-form wild Arceus on option 1", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCEUS_TRIAL, defaultParty);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    const enemyField = scene.getEnemyField();
    expect(game).toBeAtPhase("CommandPhase");
    expect(enemyField.length).toBe(1);
    expect(enemyField[0].species.speciesId).toBe(SpeciesId.ARCEUS);
    expect(enemyField[0].getFormKey()).toBe("normal");
  });

  it("does nothing while the enemy Arceus is above the 50% HP threshold", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCEUS_TRIAL, defaultParty);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    const enemyArceus = scene.getEnemyField()[0];
    enemyArceus.hp = Math.ceil(enemyArceus.getMaxHp() * 0.51);

    const shiftPhaseSpy = vi.spyOn(scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    initArceusTrialPhaseTwo(enemyArceus);

    expect(enemyArceus.getFormKey()).toBe("normal");
    expect(shiftPhaseSpy).toHaveBeenCalledOnce();
  });

  it("transforms the enemy Arceus into True Form once it crosses the 50% HP threshold", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCEUS_TRIAL, defaultParty);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    const enemyArceus = scene.getEnemyField()[0];
    const baseStatsBefore = enemyArceus.calculateBaseStats();
    enemyArceus.hp = Math.floor(enemyArceus.getMaxHp() * 0.49);

    initArceusTrialPhaseTwo(enemyArceus);
    // triggerPokemonFormChange() only queues a QuietFormChangePhase rather than applying the form
    // change synchronously - let the interceptor actually run it.
    await game.phaseInterceptor.to("QuietFormChangePhase");
    const baseStatsAfter = enemyArceus.calculateBaseStats();
    for (let i = 0; i < baseStatsAfter.length; i++) {
      expect(baseStatsAfter[i]).toBe(baseStatsBefore[i] * 3);
    }
  });

  it("should unlock the Heavenly Flute after winning", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ARCEUS_TRIAL, defaultParty);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    expect(scene.gameData.isUnlocked(Unlockables.HEAVENLY_FLUTE)).toBe(false);

    // Playing out a full real battle turn inside a Mystery Encounter reliably hangs the test
    // harness, so skip straight to victory the same way other ME encounter tests do, then let the
    // interceptor drive MysteryEncounterRewardsPhase (which actually calls encounter.onRewards())
    // and the UnlockPhase it queues to completion.
    await skipBattleRunMysteryEncounterRewardsPhase(game);
    await game.phaseInterceptor.to("UnlockPhase");

    expect(scene.gameData.isUnlocked(Unlockables.HEAVENLY_FLUTE)).toBe(true);
  });
});
