import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("System - Game Data (MissingNo. save compatibility)", () => {
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

  it("should backfill MissingNo.'s entries and still save successfully when loading a pre-existing save that predates it", async () => {
    // everything.prsv predates MissingNo.'s addition - it has no starterData/dexData entry for
    // it at all. Loading it should backfill both with fresh defaults instead of getting flagged
    // as corrupt (the exact bug reported this session: saveSystem() aborted with "data loss
    // detected" for every real account, since MissingNo. gained starterCost and thus became
    // subject to validateSystemData()'s completeness check).
    await game.importData("./test/utils/saves/everything.prsv");

    expect(game.scene.gameData.starterData[SpeciesId.MISSING_NO]).toBeDefined();
    expect(game.scene.gameData.dexData[SpeciesId.MISSING_NO]).toBeDefined();
    expect(game.scene.gameData.dexData[SpeciesId.MISSING_NO].caughtAttr).toBe(0n);

    const saveResult = await game.scene.gameData.saveSystem();
    expect(saveResult).toBe(true);
  });
});
