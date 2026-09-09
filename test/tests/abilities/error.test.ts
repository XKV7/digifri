import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPassiveCandyCount } from "#balance/starters";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("AbilityId - Error (MissingNo. passive)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").enemyAbility(AbilityId.BALL_FETCH);
  });

  it("should be MissingNo.'s configured passive", () => {
    expect(speciesDataRegistry.getPassive(SpeciesId.MISSING_NO, 0)).toBe(AbilityId.ERROR);
  });

  it("should require 1000 candies to unlock, unlike other cost-1 starters", () => {
    expect(getPassiveCandyCount(1, SpeciesId.MISSING_NO)).toBe(1000);
    // A real cost-1 starter must be unaffected by the MissingNo. override.
    expect(getPassiveCandyCount(1, SpeciesId.CATERPIE)).toBe(40);
  });

  it("should guarantee a hit with Guillotine (a one-hit-KO move) despite its normal 30% accuracy at equal levels", async () => {
    // Same level as the target -> OneHitKOAccuracyAttr computes a real, RNG-rollable 30%
    // accuracy (30 + 100*(1 - target.level/user.level)). Note: the *separate* level-based
    // "target is higher level" hard-fail condition on OneHitKOAttr is untouched by Error (and by
    // No Guard too, in mainline Pokemon) - Error only bypasses the accuracy roll itself.
    game.override
      .starterSpecies(SpeciesId.MISSING_NO)
      .startingLevel(50)
      .passiveAbility(AbilityId.ERROR)
      .moveset([MoveId.GUILLOTINE])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(50)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const enemy = game.field.getEnemyPokemon();
    const startingHp = enemy.hp;

    game.move.select(MoveId.GUILLOTINE);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(startingHp);
  });

  it("should not affect a normal move's accuracy for a Pokemon with the Error passive", async () => {
    // Tackle isn't a one-hit-KO move, so Error shouldn't force it to always hit - just checking
    // the passive doesn't broadly bypass all accuracy checks like No Guard does.
    game.override
      .starterSpecies(SpeciesId.MISSING_NO)
      .passiveAbility(AbilityId.ERROR)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.NO_GUARD) // NO_GUARD only exists here to make the enemy's own move land reliably
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const missingno = game.field.getPlayerPokemon();
    expect(missingno.hasAbilityWithAttr("AlwaysHitOhkoAbAttr")).toBe(true);
    expect(missingno.hasAbilityWithAttr("AlwaysHitAbAttr")).toBe(false);
  });

  it("should learn all 4 one-hit-KO moves at level 100 but not before, and no TM moves at all", () => {
    const levelMoves = speciesDataRegistry.getLevelMoves(SpeciesId.MISSING_NO);
    const ohkoMoves = [MoveId.GUILLOTINE, MoveId.HORN_DRILL, MoveId.FISSURE, MoveId.SHEER_COLD];

    for (const moveId of ohkoMoves) {
      const entry = levelMoves.find(([, m]) => m === moveId);
      expect(entry).toBeDefined();
      expect(entry![0]).toBe(100);
    }

    expect(speciesDataRegistry.getTms(SpeciesId.MISSING_NO)).toEqual([]);
  });
});
