/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type { PvpSwitchCommand, PvpTurnCommand } from "#app/pvp-room";
import { AbilityId } from "#enums/ability-id";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { CommandPhase } from "#phases/command-phase";
import type { PvpEnemyCommandPhase } from "#phases/pvp-enemy-command-phase";
import type { PvpEnemySwitchPhase } from "#phases/pvp-enemy-switch-phase";
import { GameManager } from "#test/framework/game-manager";
import type { MockClock } from "#test/mocks/mock-clock";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression coverage for PvP forfeiting: the repurposed Run command (see handleRunCommand() in
 * command-phase.ts) and the per-action countdown timer (PVP_TURN_TIMEOUT_MS in pvp-battle.ts)
 * both funnel into forfeitPvpBattle(), and the opponent-side "forfeit" PvpTurnCommand/
 * PvpSwitchCommand variant (see PvpForfeitCommand's doc comment in pvp-room.ts) is what lets the
 * OTHER client actually notice instead of hanging forever on a command that will now never
 * arrive.
 */
describe("PvP forfeiting", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("PvpEnemyCommandPhase.applyCommand() treats an opponent forfeit as a win for this side", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    const phase = globalScene.phaseManager.create("PvpEnemyCommandPhase", 0) as PvpEnemyCommandPhase;
    (phase as unknown as { applyCommand: (c: PvpTurnCommand) => void }).applyCommand({ command: "forfeit" });

    await game.phaseInterceptor.to("PvpBattleEndPhase");
    expect(game.textInterceptor.logs).toContain("대전에서 승리했습니다!");
  });

  it("PvpEnemySwitchPhase.applyCommand() treats an opponent forfeit as a win for this side", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    const phase = globalScene.phaseManager.create("PvpEnemySwitchPhase", 0, 1) as PvpEnemySwitchPhase;
    (phase as unknown as { applyCommand: (c: PvpSwitchCommand) => void }).applyCommand({ command: "forfeit" });

    await game.phaseInterceptor.to("PvpBattleEndPhase");
    expect(game.textInterceptor.logs).toContain("대전에서 승리했습니다!");
  });

  it("the repurposed Run command forfeits (loses) a PvP battle instead of showing the normal trainer-battle escape refusal", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    game.scene.currentBattle.isPvpBattle = true;

    const commandPhase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
    commandPhase.handleCommand(Command.RUN, 0);

    await game.phaseInterceptor.to("PvpBattleEndPhase");
    expect(game.textInterceptor.logs).toContain("대전에서 패배했습니다...");
  });

  it("auto-forfeits (loses) if no command is submitted within the per-action time limit", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    // Turn 1's CommandPhase already started (with isPvpBattle still false, before this test could
    // set it) as part of startBattle() itself - resolve it normally with a harmless move first, so
    // the flag below is in place *before* turn 2's CommandPhase actually starts and arms its timer.
    game.move.select(MoveId.SPLASH);
    game.scene.currentBattle.isPvpBattle = true;
    await game.phaseInterceptor.to("CommandPhase");

    // No move/switch/forfeit submitted for turn 2 - the test scene's mocked clock (see MockClock)
    // fires every delayedCall after ~1ms regardless of the real 60-second delay requested, so this
    // resolves quickly without needing to fast-forward 60 real seconds.
    await game.phaseInterceptor.to("PvpBattleEndPhase");
    expect(game.textInterceptor.logs).toContain("대전에서 패배했습니다...");
  });

  it("does not auto-forfeit once a real command has been submitted for the turn", async () => {
    // Uses the real (60s) delay instead of the test scene's usual ~1ms mocked one (see MockClock)
    // specifically so the timer can't race the async gap between reaching CommandPhase and this
    // test submitting its own move a moment later - unlike the timeout tests above, this test
    // wants the timer to definitely NOT have fired yet by the time it checks.
    (game.scene.time as MockClock).overrideDelay = null;

    await game.classicMode.startBattle(SpeciesId.RATTATA);
    game.move.select(MoveId.SPLASH);
    game.scene.currentBattle.isPvpBattle = true;
    await game.phaseInterceptor.to("CommandPhase");

    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(globalScene.phaseManager.hasPhaseOfType("PvpBattleEndPhase")).toBe(false);
    expect(game.textInterceptor.logs).not.toContain("대전에서 패배했습니다...");
  });
});
