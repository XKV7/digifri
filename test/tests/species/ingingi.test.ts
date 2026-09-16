/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Species - Ingingi", () => {
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
      .battleStyle("single")
      .criticalHits(false)
      .starterSpecies(SpeciesId.INGINGI)
      .ability(AbilityId.PARENTAL_OVERBOND)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
  });

  it("strikes twice with a normal attacking move, both hits at full (unreduced) power", async () => {
    // A much higher enemy level (and thus max HP) than the default 100 keeps Snorlax from fainting
    // partway through the second strike, which would otherwise clamp its measured damage below the
    // second hit's real (equal-to-the-first) value.
    game.override.moveset([MoveId.INGING_EUINGING]).enemyLevel(1000);
    await game.classicMode.startBattle(SpeciesId.INGINGI);

    const ingingi = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    let enemyStartingHp = enemy.hp;

    game.move.select(MoveId.INGING_EUINGING);

    await game.phaseInterceptor.to("DamageAnimPhase");
    const firstStrikeDamage = enemyStartingHp - enemy.hp;
    enemyStartingHp = enemy.hp;

    await game.phaseInterceptor.to("MoveEndPhase", false);
    const secondStrikeDamage = enemyStartingHp - enemy.hp;

    expect(ingingi.turnData.hitCount).toBe(2);
    expect(firstStrikeDamage).toBeGreaterThan(0);
    // Unlike Parental Bond (25% on the second hit), Parental Overbond deals full damage twice.
    expect(secondStrikeDamage).toBe(firstStrikeDamage);
  });

  it("raises all 7 battle stats by 2 stages with Ddalchum, without needing to recharge afterward", async () => {
    game.override.moveset([MoveId.DDALCHUM]);
    await game.classicMode.startBattle(SpeciesId.INGINGI);

    const ingingi = game.field.getPlayerPokemon();

    game.move.select(MoveId.DDALCHUM);
    await game.toEndOfTurn();

    for (const stat of BATTLE_STATS) {
      expect(ingingi.getStatStage(stat)).toBe(2);
    }
    // Parental Overbond blocks the RECHARGING tag Ddalchum's own RechargeAttr would add.
    expect(ingingi.getTag(BattlerTagType.RECHARGING)).toBeUndefined();
  });

  it("does need to recharge after Ddalchum without Parental Overbond active", async () => {
    game.override.ability(AbilityId.BALL_FETCH).moveset([MoveId.DDALCHUM]);
    await game.classicMode.startBattle(SpeciesId.INGINGI);

    const ingingi = game.field.getPlayerPokemon();

    game.move.select(MoveId.DDALCHUM);
    await game.toEndOfTurn();

    expect(ingingi.getTag(BattlerTagType.RECHARGING)).toBeDefined();
  });
});
