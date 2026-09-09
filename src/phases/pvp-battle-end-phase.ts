/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Ends a PvP battle once one side's whole party has fainted. Deliberately does not reuse
 * GameOverPhase/VictoryPhase's normal continuation (BattleEndPhase, EggLapsePhase,
 * SelectModifierPhase, NewBattlePhase, session save/run-history/achievement handling, ...) - all
 * of that is real-run machinery that must never run for a one-off PvP battle (see pvp-battle.ts's
 * file header), and letting a PvP win fall through to it was accidentally dragging the winner
 * into normal wave progression as if their real run had just cleared a battle.
 *
 * Shows the result, waits a few seconds, then fully resets the scene back to the title screen
 * (the same globalScene.reset(true) used by SAVE_AND_QUIT and the real GameOverPhase's own
 * eventual return-to-title) for both the winner and the loser — leaving no PvP battle state
 * (currentBattle, arena, seed, party) behind for whatever either player does next.
 */

import { globalScene } from "#app/global-scene";
import { submitLeaderboardStat } from "#app/leaderboard";
import { clearPvpBattleContext } from "#app/pvp-battle";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";

const PVP_BATTLE_END_DISPLAY_MS = 3000;

export class PvpBattleEndPhase extends BattlePhase {
  public readonly phaseName = "PvpBattleEndPhase";
  private readonly won: boolean;

  constructor(won: boolean) {
    super();
    this.won = won;
  }

  start(): void {
    super.start();

    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(this.won ? "대전에서 승리했습니다!" : "대전에서 패배했습니다...");

    if (this.won) {
      // gameStats is account-level (saved via saveSystem(), not the run-specific session save),
      // so incrementing it here doesn't touch any real run's data - see pvp-battle.ts's file header.
      globalScene.gameData.gameStats.pvpWins++;
      submitLeaderboardStat("pvpWins", globalScene.gameData.gameStats.pvpWins);
      void globalScene.gameData.saveSystem();
    }

    globalScene.time.delayedCall(PVP_BATTLE_END_DISPLAY_MS, () => {
      clearPvpBattleContext();
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.reset(true);
      // Undo the item-bar hiding pvp-battle.ts's startPvpBattle() applies for the duration of
      // the PvP battle, so a subsequent real run isn't left with hidden item icons.
      globalScene.setModifiersVisible(true);
    });
  }
}
