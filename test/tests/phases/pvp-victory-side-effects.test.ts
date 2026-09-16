/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression coverage for VictoryPhase's isPvpBattle skip (see victory-phase.ts). Defeating an
 * enemy Pokemon used to unconditionally grant real, permanently-persisted account progress
 * (gameStats.pokemonDefeated, and party EXP - which itself cascades into friendship/candy gain,
 * achievement/ribbon unlocks, and even mid-battle evolution touching the real Pokedex, see
 * PlayerPokemon#addFriendship()/evolve()) even during a PvP battle, whose Pokemon and outcome are
 * meant to be entirely throwaway (see pvp-battle.ts's file header). PvpBattleEndPhase only ever
 * blocked the wave-progression continuation further down in VictoryPhase.start(), not this
 * reward-granting prefix, which used to run unconditionally on every single enemy faint.
 *
 * Asserts against gameStats.pokemonDefeated specifically (rather than party EXP directly, which
 * this test harness's forced move-select doesn't reliably grant even outside PvP) since it's
 * gated by the exact same `if (!isPvpBattle)` block as the EXP grant in the fixed code, and is
 * simple to observe directly.
 */
describe("VictoryPhase - PvP battle skips real-account side effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(1);
  });

  it("does not increment gameStats.pokemonDefeated when isPvpBattle is set", async () => {
    await game.classicMode.startBattle(SpeciesId.MEWTWO);
    game.scene.currentBattle.isPvpBattle = true;

    const defeatedBefore = game.scene.gameData.gameStats.pokemonDefeated;

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("PvpBattleEndPhase");

    expect(game.scene.gameData.gameStats.pokemonDefeated).toBe(defeatedBefore);
  });

  it("does increment gameStats.pokemonDefeated for a normal (non-PvP) battle (regression guard)", async () => {
    await game.classicMode.startBattle(SpeciesId.MEWTWO);

    const defeatedBefore = game.scene.gameData.gameStats.pokemonDefeated;

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("VictoryPhase");

    expect(game.scene.gameData.gameStats.pokemonDefeated).toBe(defeatedBefore + 1);
  });
});
