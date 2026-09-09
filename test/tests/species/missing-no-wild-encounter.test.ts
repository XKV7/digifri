import { getStarterValueFriendshipCap } from "#balance/starters";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Species - MissingNo. wild Beach encounter", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should spawn as a level 100-200 MissingNo. on the winning 1/512 roll in the Beach biome", async () => {
    game.override.startingBiome(BiomeId.BEACH);
    // Always return the minimum of the requested range: makes the 1/512 species roll land on 0
    // (the winning value) and the subsequent 100-200 level roll land on exactly 100.
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((min: number) => min);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.species.speciesId).toBe(SpeciesId.MISSING_NO);
    expect(enemy.level).toBeGreaterThanOrEqual(100);
    expect(enemy.level).toBeLessThanOrEqual(200);
  });

  it("should never spawn in the Beach biome when the roll doesn't land on the winning value", async () => {
    game.override.startingBiome(BiomeId.BEACH);
    // Always return the maximum of the requested range - the 1/512 roll can never land on 0.
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((_min: number, max: number) => max);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.species.speciesId).not.toBe(SpeciesId.MISSING_NO);
  });

  it("should block catching the level 100+ Beach MissingNo. encounter", async () => {
    game.override.startingBiome(BiomeId.BEACH);
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((min: number) => min);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.species.speciesId).toBe(SpeciesId.MISSING_NO);

    const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    // biome-ignore lint/complexity/useLiteralKeys: accessing a private method for testing
    const canUseBall = (commandPhase as any)["checkCanUseBall"]();
    expect(canUseBall).toBe(false);
  });

  it("should not block catching a normal, low-level MissingNo. (e.g. one the player already owns)", async () => {
    // Sanity check that the uncatchable block is scoped to level >= 100, not to the species
    // itself - a regular level-5 MissingNo. (obtained via egg/starter-select) must stay
    // catchable like any other Pokemon if it's ever fought as a wild/rental encounter.
    game.override.enemySpecies(SpeciesId.MISSING_NO).enemyLevel(5);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
    // biome-ignore lint/complexity/useLiteralKeys: accessing a private method for testing
    const canUseBall = (commandPhase as any)["checkCanUseBall"]();
    expect(canUseBall).toBe(true);
  });

  it("should roll the 1/512 Beach chance once per wave, not once per enemy slot in a double battle", async () => {
    // The species-roll is shared by every enemy slot generated this wave, so a double battle
    // must not get two independent chances at it. Simulate that precisely: the very first roll
    // of the winning shape (integerInRange(0, 511)) returns the winning value, and any further
    // roll of that same shape returns a losing one - if the code still rolled per-slot (the bug
    // this test guards against), the second enemy would be a normal species instead of also
    // being MissingNo.
    let winningShapeRolls = 0;
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((min: number, max: number) => {
      if (min === 0 && max === 511) {
        winningShapeRolls++;
        return winningShapeRolls === 1 ? 0 : 1;
      }
      return min;
    });
    game.override.startingBiome(BiomeId.BEACH).battleStyle("double");

    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.BULBASAUR);

    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty).toHaveLength(2);
    expect(enemyParty[0].species.speciesId).toBe(SpeciesId.MISSING_NO);
    expect(enemyParty[1].species.speciesId).toBe(SpeciesId.MISSING_NO);
    expect(winningShapeRolls).toBe(1);
  });

  it("should give MissingNo. the same in-run candy gain (friendship cap) as a top-tier Legendary", () => {
    expect(getStarterValueFriendshipCap(1, SpeciesId.MISSING_NO)).toBe(getStarterValueFriendshipCap(9));
    expect(getStarterValueFriendshipCap(1, SpeciesId.MISSING_NO)).toBe(450);
    // A real cost-1 starter must be unaffected by the MissingNo. override.
    expect(getStarterValueFriendshipCap(1, SpeciesId.CATERPIE)).toBe(25);
  });
});
