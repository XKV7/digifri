/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type { PvpTurnCommand } from "#app/pvp-room";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { PvpEnemyCommandPhase } from "#phases/pvp-enemy-command-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression coverage for the PvP move-command wire format (see PvpTurnCommand's doc comment in
 * pvp-room.ts). It used to carry a raw index into the sender's moveset (`moveIndex`); that
 * desynced the two clients' battle state whenever the resolved move differed from whichever slot
 * the cursor happened to be on - Struggle (every move unusable) is the common case. It now carries
 * the sender's already-resolved MoveId directly (`moveId`).
 *
 * This exercises PvpEnemyCommandPhase.applyCommand() - the receiving side, where the desync
 * actually manifested as the wrong move being executed - directly, constructing the phase and
 * feeding it a PvpTurnCommand by hand rather than wiring up a real cross-client Firestore
 * exchange (getPvpBattleContext/submitPvpTurnCommand/subscribePvpTurnCommand), which this test
 * doesn't need in order to verify how a received command gets applied.
 */
describe("PvpEnemyCommandPhase.applyCommand", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("applies the received MoveId directly (Struggle), instead of re-deriving it from an index", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    const phase = globalScene.phaseManager.create("PvpEnemyCommandPhase", 0) as PvpEnemyCommandPhase;
    // `applyCommand` is private - accessed directly here to test it in isolation
    (phase as unknown as { applyCommand: (c: PvpTurnCommand) => void }).applyCommand({
      command: "fight",
      moveId: MoveId.STRUGGLE,
    });

    const enemyTurnCommand = globalScene.currentBattle.turnCommands[0 + BattlerIndex.ENEMY];
    expect(enemyTurnCommand?.command).toBe(Command.FIGHT);
    expect(enemyTurnCommand?.move?.move).toBe(MoveId.STRUGGLE);
  });

  it("applies the received MoveId directly under normal conditions (regression guard)", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    const phase = globalScene.phaseManager.create("PvpEnemyCommandPhase", 0) as PvpEnemyCommandPhase;
    (phase as unknown as { applyCommand: (c: PvpTurnCommand) => void }).applyCommand({
      command: "fight",
      moveId: MoveId.SPLASH,
    });

    const enemyTurnCommand = globalScene.currentBattle.turnCommands[0 + BattlerIndex.ENEMY];
    expect(enemyTurnCommand?.move?.move).toBe(MoveId.SPLASH);
  });
});
