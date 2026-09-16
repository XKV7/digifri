/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { Command } from "#enums/command";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
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

  it("sets the Event Horizon field even as a non-boss player Pokemon with its passive forced on", async () => {
    // Every other test in this file exercises Event Horizon via Adeus as the enemy encounter
    // Pokemon, which always has its passive active through isBoss() regardless of the raw passive
    // flag (see Pokemon#hasPassive()). A PvP-registered Adeus is built as a normal, non-boss
    // PlayerPokemon instead (see buildPvpPokemon() in pvp-battle.ts, which forwards the registered
    // Starter's own `passive` field straight through) - hasPassive() only falls back to isBoss()
    // when that raw flag is false, so this is the one path that silently never activated Event
    // Horizon at all when addToPartyPvp() (starter-select-ui-handler.ts) hardcoded every
    // PvP-registered Starter's `passive` to false, regardless of species.
    game.override.starterSpecies(SpeciesId.ADEUS).passiveAbility(AbilityId.EVENT_HORIZON);
    await game.classicMode.startBattle(SpeciesId.ADEUS);

    const adeus = game.field.getPlayerPokemon();
    expect(adeus.isBoss()).toBe(false);
    expect(adeus.hasPassive()).toBe(true);
    expect(game.scene.arena.getTag(ArenaTagType.EVENT_HORIZON)).toBeDefined();
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

describe("Moves - Causality Collapse", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.CAUSALITY_COLLAPSE])
      // Deliberately slower than the enemy - Causality Collapse's own +8 priority (see below) is
      // what this test setup is actually exercising, not a raw Speed advantage.
      .startingLevel(10)
      .enemyLevel(100);
  });

  it("is a 140-power, 100-accuracy, 5-PP special Psychic move with 30% flinch chance and priority +8", () => {
    const move = allMoves[MoveId.CAUSALITY_COLLAPSE];
    expect(move.type).toBe(PokemonType.PSYCHIC);
    expect(move.category).toBe(MoveCategory.SPECIAL);
    expect(move.power).toBe(140);
    expect(move.accuracy).toBe(100);
    expect(move.pp).toBe(5);
    expect(move.chance).toBe(30);
    expect(move.priority).toBe(8);
    expect(move.hasAttr("FlinchAttr")).toBe(true);
  });

  it("goes first even against a much faster opponent, due to its own priority", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    game.move.select(MoveId.CAUSALITY_COLLAPSE);
    // Stops right as the turn's first MovePhase starts (before running it) - whichever Pokemon it
    // belongs to is unambiguous proof of move order, unlike inferring it from damage/HP alone.
    await game.phaseInterceptor.to("MovePhase", false);

    const actingPokemon = (
      globalScene.phaseManager.getCurrentPhase() as unknown as { getPokemon: () => { isPlayer: () => boolean } }
    ).getPokemon();
    expect(actingPokemon.isPlayer()).toBe(true);
  });

  it("can't be used two turns in a row", async () => {
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    game.move.select(MoveId.CAUSALITY_COLLAPSE);
    await game.toNextTurn();

    // Attempting to use Causality Collapse again immediately should fall back to Struggle, exactly
    // like Gigaton Hammer/Blood Moon (see consecutiveUseRestriction in move-condition.ts).
    game.move.select(MoveId.CAUSALITY_COLLAPSE);
    await game.toNextTurn();

    const player = game.field.getPlayerPokemon();
    expect(player.getLastXMoves()[0]?.move).toBe(MoveId.STRUGGLE);
  });

  it("can be used again after using a different move in between", async () => {
    game.override.moveset([MoveId.CAUSALITY_COLLAPSE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.RATTATA);

    game.move.select(MoveId.CAUSALITY_COLLAPSE);
    await game.toNextTurn();
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    game.move.select(MoveId.CAUSALITY_COLLAPSE);
    await game.toNextTurn();

    const player = game.field.getPlayerPokemon();
    expect(player.getLastXMoves()[0]?.move).toBe(MoveId.CAUSALITY_COLLAPSE);
  });
});
