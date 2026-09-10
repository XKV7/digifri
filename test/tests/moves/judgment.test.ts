import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Moves - Judgment (Legend Plate)", () => {
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
      .moveset([MoveId.JUDGMENT])
      .ability(AbilityId.MULTITYPE)
      .battleStyle("single")
      .criticalHits(false)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("does not change Arceus's form without a held Legend Plate", async () => {
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.ARCEUS);

    const arceus = game.field.getPlayerPokemon();
    expect(arceus.getFormKey()).toBe("normal");

    game.move.select(MoveId.JUDGMENT);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(arceus.getFormKey()).toBe("normal");
    expect(game.phaseInterceptor.log.includes("LegendPlateFormChangePhase")).toBe(false);
  });

  it("retypes Arceus (and Judgment) to the most effective type against the target, breaking ties by lowest type number", async () => {
    // Water is weak to both Grass (11) and Electric (12) at 2x - Grass should win the tie.
    game.override.enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.ARCEUS);

    const arceus = game.field.getPlayerPokemon();
    const legendPlateType = generateModifierType(modifierTypes.FORM_CHANGE_ITEM, [FormChangeItem.LEGEND_PLATE])!;
    await game.scene.addModifier(legendPlateType.newModifier(arceus));

    game.move.select(MoveId.JUDGMENT);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(game.phaseInterceptor.log.includes("LegendPlateFormChangePhase")).toBe(true);
    expect(arceus.getFormKey()).toBe("grass");
    expect(arceus.getTypes()).toStrictEqual([PokemonType.GRASS]);
    expect(arceus.getMoveType(allMoves[MoveId.JUDGMENT])).toBe(PokemonType.GRASS);
  });

  it("re-evaluates the best type every time Judgment is used against a new target", async () => {
    // Pure Ghost-type Duskull is only weak to Ghost (7) and Dark (16) at 2x - Ghost should win the tie.
    game.override.enemySpecies(SpeciesId.DUSKULL);
    await game.classicMode.startBattle(SpeciesId.ARCEUS);

    const arceus = game.field.getPlayerPokemon();
    const legendPlateType = generateModifierType(modifierTypes.FORM_CHANGE_ITEM, [FormChangeItem.LEGEND_PLATE])!;
    await game.scene.addModifier(legendPlateType.newModifier(arceus));

    game.move.select(MoveId.JUDGMENT);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(arceus.getFormKey()).toBe("ghost");
    expect(arceus.getTypes()).toStrictEqual([PokemonType.GHOST]);
  });
});
