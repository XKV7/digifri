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
import { AdeusEncounter } from "#mystery-encounters/adeus-encounter";
import { GameManager } from "#test/framework/game-manager";
import { runMysteryEncounterToEnd, skipBattleRunMysteryEncounterRewardsPhase } from "#test/utils/encounter-test-utils";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const namespace = "mysteryEncounters/adeusEncounter";
const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultWave = 45;

describe("Adeus - Mystery Encounter", () => {
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
      .enemyLevel(1)
      .criticalHits(false);
  });

  it("should have the correct properties", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ADEUS_ENCOUNTER, defaultParty);

    expect(AdeusEncounter.encounterType).toBe(MysteryEncounterType.ADEUS_ENCOUNTER);
    expect(AdeusEncounter.dialogue.intro).toStrictEqual([{ text: `${namespace}:intro` }]);
    expect(AdeusEncounter.dialogue.encounterOptionsDialogue?.title).toBe(`${namespace}:title`);
    expect(AdeusEncounter.options.length).toBe(2);
  });

  it("should leave without battling on option 2", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ADEUS_ENCOUNTER, defaultParty);
    await runMysteryEncounterToEnd(game, 2);

    expect(scene.getEnemyField().length).toBe(0);
  });

  it("should start a battle against Adeus on option 1", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ADEUS_ENCOUNTER, defaultParty);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    const enemyField = scene.getEnemyField();
    expect(game).toBeAtPhase("CommandPhase");
    expect(enemyField.length).toBe(1);
    expect(enemyField[0].species.speciesId).toBe(SpeciesId.ADEUS);
  });

  it("does not allow catching Adeus", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ADEUS_ENCOUNTER, defaultParty);

    expect(AdeusEncounter.catchAllowed).toBe(false);
  });

  it("unlocks Adeus as a starter after winning", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.ADEUS_ENCOUNTER, defaultParty);
    await runMysteryEncounterToEnd(game, 1, undefined, true);

    expect(scene.gameData.isUnlocked(Unlockables.ADEUS)).toBe(false);

    // Playing out a full real battle turn inside a Mystery Encounter reliably hangs the test
    // harness, so skip straight to victory the same way other ME encounter tests do, then let the
    // interceptor drive MysteryEncounterRewardsPhase (which actually calls encounter.onRewards())
    // and the UnlockPhase it queues to completion.
    await skipBattleRunMysteryEncounterRewardsPhase(game);
    await game.phaseInterceptor.to("UnlockPhase");

    expect(scene.gameData.isUnlocked(Unlockables.ADEUS)).toBe(true);
    expect(scene.gameData.dexData[SpeciesId.ADEUS].caughtAttr).not.toBe(0n);
  });
});
