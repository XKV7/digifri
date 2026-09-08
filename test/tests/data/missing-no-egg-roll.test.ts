import { Egg } from "#data/egg";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { Unlockables } from "#enums/unlockables";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Data - Egg (MissingNo. acquisition)", () => {
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

  it("should hatch MissingNo. on the winning 1/1024 roll once Classic mode has been cleared", () => {
    game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
    // id: 1 avoids the (tier===COMMON && id%204===0) Manaphy-egg special case short-circuiting
    // rollSpecies() before it ever reaches the MissingNo. check.
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockReturnValue(0);
    const egg = new Egg({ id: 1, tier: EggTier.COMMON, sourceType: EggSourceType.GACHA_MOVE, pulled: false });

    expect(egg.species).toBe(SpeciesId.MISSING_NO);
  });

  it("should never hatch MissingNo. before Classic mode has been cleared, even on the winning roll", () => {
    game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = false;
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockReturnValue(0);
    const egg = new Egg({ id: 1, tier: EggTier.COMMON, sourceType: EggSourceType.GACHA_MOVE, pulled: false });

    expect(egg.species).not.toBe(SpeciesId.MISSING_NO);
  });

  it("should never hatch MissingNo. from a non-Common tier egg, even on the winning roll", () => {
    game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockReturnValue(0);
    const egg = new Egg({ id: 1, tier: EggTier.RARE, sourceType: EggSourceType.GACHA_MOVE, pulled: false });

    expect(egg.species).not.toBe(SpeciesId.MISSING_NO);
  });

  it("should not weight MissingNo. into the normal Common-tier species pool (no starterCost-driven NaN corruption)", () => {
    // MissingNo. has starterCost but is explicitly excluded from the weighted pool in
    // rollSpecies() (ignoredSpecies) - roll a batch of Common eggs with the MissingNo. gate
    // guaranteed to fail (mocked roll = range-1, i.e. never the winning 0) and confirm every
    // one resolves to a real, valid species instead of undefined/NaN.
    game.scene.gameData.unlocks[Unlockables.ENDLESS_MODE] = true;
    vi.spyOn(Phaser.Math.RND, "integerInRange").mockImplementation((_min: number, max: number) => max);

    for (let i = 0; i < 20; i++) {
      const egg = new Egg({ id: i * 2 + 1, tier: EggTier.COMMON, sourceType: EggSourceType.GACHA_MOVE, pulled: false });
      expect(Number.isInteger(egg.species)).toBe(true);
      expect(egg.species).not.toBe(SpeciesId.MISSING_NO);
    }
  });

  it("EX gacha rolls should never draw a Common-tier egg", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const egg = new Egg({ id: 1, sourceType: EggSourceType.GACHA_MASTER, pulled: false });

    expect(egg.tier).not.toBe(EggTier.COMMON);
  });

  it("EX gacha rolls should be able to draw the EX tier on the rarest possible roll", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const egg = new Egg({ id: 1, sourceType: EggSourceType.GACHA_MASTER, pulled: false });

    expect(egg.tier).toBe(EggTier.EX);
    expect(egg.isShiny).toBe(true);
  });
});
