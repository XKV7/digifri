/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Nightmare (Hardcore) - enemy critical hit rate", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE)
      .startingLevel(100)
      .enemyLevel(100);
  });

  it("gives enemy attacks +1 crit stage over classic", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    vi.spyOn(player, "getCritStage");

    // player.getCritStage is invoked as target.getCritStage(enemy, tackle) whenever the enemy's
    // Tackle lands on the player - exercising the enemy-only bonus this test is checking.
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(player.getCritStage).toHaveLastReturnedWith(0);

    game.scene.gameMode = getGameMode(GameModes.NIGHTMARE);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(player.getCritStage).toHaveLastReturnedWith(1);
  });
});
