/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PvP counterpart to the enemy-side forced switch-in that normally follows a fainted trainer
 * Pokemon (see faint-phase.ts): instead of asking the synthetic Trainer's AI
 * (`trainer.getNextSummonIndex()`) which of its remaining Pokemon to send out, waits for the
 * opposing (real, remote) account's client to submit its actual choice over Firestore (see
 * pvp-room.ts's submitPvpSwitchCommand/subscribePvpSwitchCommand), then resolves that choice to
 * a party slot index and hands off to the real SwitchSummonPhase to actually perform it.
 */

import { globalScene } from "#app/global-scene";
import { getPvpBattleContext } from "#app/pvp-battle";
import { type PvpSwitchCommand, subscribePvpSwitchCommand } from "#app/pvp-room";
import { SwitchType } from "#enums/switch-type";
import { BattlePhase } from "#phases/battle-phase";

export class PvpEnemySwitchPhase extends BattlePhase {
  public readonly phaseName = "PvpEnemySwitchPhase";
  private readonly fieldIndex: number;
  private readonly faintedPokemonId: number;
  private unsub: (() => void) | null = null;

  constructor(fieldIndex: number, faintedPokemonId: number) {
    super();
    this.fieldIndex = fieldIndex;
    this.faintedPokemonId = faintedPokemonId;
  }

  start(): void {
    super.start();

    const ctx = getPvpBattleContext();
    if (!ctx) {
      // Shouldn't happen — isPvpBattle implies a live context — but fail safe rather than block
      // the battle forever if it somehow does.
      console.error("PvpEnemySwitchPhase started with no active PvP battle context");
      this.end();
      return;
    }

    // The opponent writes to THEIR OWN side's field (host writes hostSwitchCommands when acting
    // as host, guest writes guestSwitchCommands) — from this phase's perspective "the enemy" is
    // always the account that ISN'T mine, so watch whichever side that is.
    this.unsub = subscribePvpSwitchCommand(ctx.roomId, !ctx.isHost, this.faintedPokemonId, command => {
      this.unsub = null;
      this.applyCommand(command);
    });
  }

  private applyCommand(command: PvpSwitchCommand): void {
    const enemyParty = globalScene.getEnemyParty();
    const slotIndex = enemyParty.findIndex(p => p.id === command.pokemonId);
    if (slotIndex === -1) {
      console.error(`PvpEnemySwitchPhase: no enemy Pokemon with id ${command.pokemonId} to switch in`);
      this.end();
      return;
    }

    globalScene.phaseManager.unshiftNew(
      "SwitchSummonPhase",
      SwitchType.SWITCH,
      this.fieldIndex,
      slotIndex,
      false,
      false,
    );
    this.end();
  }
}
