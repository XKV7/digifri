/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { speciesDataRegistry } from "#app/global-species-data-registry";
import { Region } from "#data/pokemon-species";
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

  it("getExpandedSpeciesName() returns the plain localized name, not a broken pokemonForm:appendForm.* lookup", () => {
    // Ingingi's speciesId (6974) is well above getExpandedSpeciesName()'s old `< 2000` early-return
    // threshold, so it used to fall into the FORMNAME_SPECIES branch meant for real regional/Mega
    // forms - which has no "ingingi" key in pokemonForm:appendForm, so it silently rendered as the
    // raw i18next key string instead of the species' own name (same latent bug affected MissingNo./
    // Adeus, both also >= 2000, and is asserted for here too).
    const ingingi = speciesDataRegistry.getSpecies(SpeciesId.INGINGI);
    expect(ingingi.getExpandedSpeciesName()).toBe(ingingi.name);

    const missingNo = speciesDataRegistry.getSpecies(SpeciesId.MISSING_NO);
    expect(missingNo.getExpandedSpeciesName()).toBe(missingNo.name);

    const adeus = speciesDataRegistry.getSpecies(SpeciesId.ADEUS);
    expect(adeus.getExpandedSpeciesName()).toBe(adeus.name);
  });

  it("is not misclassified as a Hisuian regional form (speciesId 6974 falls in the generic 6000-7999 Hisui range)", () => {
    // Confirmed in practice: without this special case, getRegion() returned Region.HISUI and the
    // Pokedex rendered Ingingi as "Hisuian Psyduck" (species #974, 6974 % 2000) instead of itself.
    const ingingi = speciesDataRegistry.getSpecies(SpeciesId.INGINGI);
    expect(ingingi.getRegion()).toBe(Region.NORMAL);
    expect(ingingi.isRegional()).toBe(false);
  });

  it("never computes a shiny sprite key, since it has no shiny artwork", () => {
    const ingingi = speciesDataRegistry.getSpecies(SpeciesId.INGINGI);
    expect(ingingi.getSpriteId(false, undefined, true)).not.toContain("shiny__");
  });

  it("does not collide with a real species' cry (speciesId 6974 % 2000 = 974, Psyduck's)", () => {
    const ingingi = speciesDataRegistry.getSpecies(SpeciesId.INGINGI);
    expect(ingingi.getCryKey()).toBe(`cry/${SpeciesId.INGINGI}`);
  });
});
