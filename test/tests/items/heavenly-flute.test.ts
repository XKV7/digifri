import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { FormChangeItemModifierType } from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Heavenly Flute", () => {
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
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.MULTITYPE)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("changes Arceus into its True Form and triples every base stat", async () => {
    await game.classicMode.startBattle(SpeciesId.ARCEUS);

    const arceus = game.field.getPlayerPokemon();
    const baseStatsBefore = arceus.calculateBaseStats();

    const heavenlyFluteType = generateModifierType(modifierTypes.HEAVENLY_FLUTE)!;
    await game.scene.addModifier(heavenlyFluteType.newModifier(arceus));

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(arceus.getFormKey()).toBe("true-form");

    const baseStatsAfter = arceus.calculateBaseStats();
    for (const stat of [Stat.HP, Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
      expect(baseStatsAfter[stat]).toBe(baseStatsBefore[stat] * 3);
    }
  });

  it("does not boost stats without holding an active Heavenly Flute", async () => {
    await game.classicMode.startBattle(SpeciesId.ARCEUS);

    const arceus = game.field.getPlayerPokemon();
    const baseStats = arceus.calculateBaseStats();

    expect(baseStats[Stat.HP]).toBe(120);
    expect(baseStats[Stat.ATK]).toBe(120);
  });

  it("registers a FormChangeItem-based reward-pool entry for the item itself", () => {
    const heavenlyFluteType = generateModifierType(modifierTypes.HEAVENLY_FLUTE) as FormChangeItemModifierType;
    expect(heavenlyFluteType).toBeTruthy();
    expect(heavenlyFluteType.formChangeItem).toBe(FormChangeItem.HEAVENLY_FLUTE);
  });
});
