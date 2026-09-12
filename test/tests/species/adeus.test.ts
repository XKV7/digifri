/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS, Stat } from "#enums/stat";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Species - Adeus", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.ADEUS)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  it("raises 6 battle stats (all but Evasiveness) by 2 stages on switch-in via Singularity while Event Horizon is up", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const adeus = game.field.getEnemyPokemon();
    expect(adeus).toHaveAbilityApplied(AbilityId.SINGULARITY);
    for (const stat of BATTLE_STATS) {
      if (stat === Stat.EVA) {
        expect(adeus.getStatStage(stat)).toBe(0);
      } else if (stat === Stat.SPD) {
        // Net +1, not +2 - Event Horizon's own "any Pokemon entering the field" Speed drop is
        // intentionally not exempted for Adeus's own entry, stacking with Singularity's +2 here.
        expect(adeus.getStatStage(stat)).toBe(1);
      } else {
        expect(adeus.getStatStage(stat)).toBe(2);
      }
    }
  });

  it("does not raise stats via Singularity if the Event Horizon field isn't up", async () => {
    game.override.enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const adeus = game.field.getEnemyPokemon();
    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeUndefined();
    for (const stat of BATTLE_STATS) {
      expect(adeus.getStatStage(stat)).toBe(0);
    }
  });

  it("sets the Event Horizon field on switch-in via its passive", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeDefined();
  });

  it("traps both sides in battle while Event Horizon is up", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.BULBASAUR);

    const player = game.field.getPlayerPokemon();
    const adeus = game.field.getEnemyPokemon();
    expect(player.isTrapped()).toBe(true);
    expect(adeus.isTrapped()).toBe(true);
  });

  it("drops the Speed of a Pokemon entering the field by 1 stage while Event Horizon is active", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const tag = game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON);
    expect(tag).toBeDefined();

    const magikarp = game.field.getPlayerPokemon();
    // Magikarp is itself "entering the field" as Event Horizon goes up at the start of the battle,
    // so it already takes the same Speed drop applied to every entrant (see the doc comment on
    // EVENT_HORIZON's postSummonPriority in init-abilities.ts for why this also applies to Adeus's
    // own entry).
    expect(magikarp.getStatStage(Stat.SPD)).toBe(-1);

    // Directly exercising the tag's own entry hook again, mirroring a later mid-battle entry (e.g. a
    // switch-in) - a real switch can't be used here since both sides are trapped while Event Horizon
    // is up (see the test above). The phase it queues won't run until the turn advances.
    tag!.apply(false, magikarp);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("StatStageChangePhase");

    expect(magikarp.getStatStage(Stat.SPD)).toBe(-2);
  });

  it("shows a message (rather than doing nothing) when attempting to flee while Event Horizon traps the player", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    game.textInterceptor.clearLogs();
    const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    const handled = commandPhase.handleCommand(Command.RUN, 0);

    // The command must be rejected (not silently ignored) and the player told why - the underlying
    // bug this guards against left both isSwitch cases in CommandPhase#handleTrap with no matching
    // branch for EventHorizonTag (only TrappedTag/FAIRY_LOCK were handled), so nothing was ever
    // shown and the game appeared to hang after selecting Run.
    expect(handled).toBe(false);
    expect(game.textInterceptor.logs).toContain(
      i18next.t("battle:noEscapeEventHorizon", { escapeVerb: i18next.t("battle:escapeVerbFlee") }),
    );
  });

  it("clears the Event Horizon field once Adeus leaves the field", async () => {
    game.override.moveset(MoveId.SHEER_COLD).ability(AbilityId.NO_GUARD).startingLevel(100).enemyLevel(1);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeDefined();

    game.move.select(MoveId.SHEER_COLD);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeUndefined();
  });
});
