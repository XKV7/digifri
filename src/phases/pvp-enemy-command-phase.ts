/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PvP counterpart to EnemyCommandPhase: instead of running AI to pick the "enemy" side's move,
 * waits for the opposing (real, remote) account's client to submit its chosen move for this turn
 * over Firestore (see pvp-room.ts's submitPvpTurnCommand/subscribePvpTurnCommand), then fills in
 * currentBattle.turnCommands exactly like EnemyCommandPhase would. Deliberately does NOT reuse
 * EnemyCommandPhase itself — its AI auto-switch logic (keyed off battle.trainer matchup scoring)
 * must never fire in a PvP battle. See turn-init-phase.ts for where this gets pushed instead of
 * EnemyCommandPhase, gated on Battle.isPvpBattle.
 */

import { globalScene } from "#app/global-scene";
import { getPvpBattleContext } from "#app/pvp-battle";
import { type PvpTurnCommand, subscribePvpTurnCommand } from "#app/pvp-room";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { getMoveTargets } from "#moves/move-utils";
import { FieldPhase } from "#phases/field-phase";

export class PvpEnemyCommandPhase extends FieldPhase {
  public readonly phaseName = "PvpEnemyCommandPhase";
  protected fieldIndex: number;
  private unsub: (() => void) | null = null;

  constructor(fieldIndex: number) {
    super();
    this.fieldIndex = fieldIndex;
  }

  start(): void {
    super.start();

    const ctx = getPvpBattleContext();
    if (!ctx) {
      // Shouldn't happen — isPvpBattle implies a live context — but fail safe rather than block
      // the turn loop forever if it somehow does.
      console.error("PvpEnemyCommandPhase started with no active PvP battle context");
      this.applyCommand({ command: "fight", moveIndex: 0 });
      return;
    }

    const turn = globalScene.currentBattle.turn;
    // The opponent writes to THEIR OWN side's field (host writes hostTurnCommands when acting as
    // host, guest writes guestTurnCommands) — from this phase's perspective "the enemy" is always
    // the account that ISN'T mine, so watch whichever side that is.
    this.unsub = subscribePvpTurnCommand(ctx.roomId, !ctx.isHost, turn, command => {
      this.unsub = null;
      this.applyCommand(command);
    });
  }

  private applyCommand(command: PvpTurnCommand): void {
    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];
    const moveset = enemyPokemon.getMoveset();
    const moveEntry = moveset[command.moveIndex] ?? moveset[0];
    const moveId = moveEntry?.moveId ?? MoveId.STRUGGLE;
    const moveTargets = getMoveTargets(enemyPokemon, moveId);

    globalScene.currentBattle.turnCommands[this.fieldIndex + BattlerIndex.ENEMY] = {
      command: Command.FIGHT,
      cursor: command.moveIndex,
      move: { move: moveId, targets: moveTargets.targets, useMode: MoveUseMode.NORMAL },
    };

    this.end();
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }
}
