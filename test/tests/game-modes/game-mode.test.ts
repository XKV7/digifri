import type { GameMode } from "#app/game-mode";
import { getGameMode } from "#app/game-mode";
import { GameModes } from "#enums/game-modes";
import { GameManager } from "#test/framework/game-manager";
import * as Utils from "#utils/common";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("game-mode", () => {
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

  describe("classic", () => {
    let classicGameMode: GameMode;
    beforeEach(() => {
      classicGameMode = getGameMode(GameModes.CLASSIC);
    });
    it("does NOT spawn trainers within 3 waves of fixed battle", () => {
      // set wave 16 to be a fixed trainer fight meaning wave 13-19 don't allow trainer spawns
      vi.spyOn(classicGameMode, "isFixedBattle").mockImplementation((n: number) => n === 16);
      vi.spyOn(game.scene.arena, "trainerChance", "get").mockReturnValue(1);
      vi.spyOn(Utils, "randSeedInt").mockReturnValue(0);
      expect(classicGameMode.isWaveTrainer(11)).toBeFalsy();
      expect(classicGameMode.isWaveTrainer(12)).toBeTruthy();
      expect(classicGameMode.isWaveTrainer(13)).toBeFalsy();
      expect(classicGameMode.isWaveTrainer(14)).toBeFalsy();
      expect(classicGameMode.isWaveTrainer(15)).toBeFalsy();
      // Wave 16 is a fixed trainer battle
      expect(classicGameMode.isWaveTrainer(17)).toBeFalsy();
      expect(classicGameMode.isWaveTrainer(18)).toBeFalsy();
      expect(classicGameMode.isWaveTrainer(19)).toBeFalsy();
    });
  });

  describe("nightmare (hardcore)", () => {
    let nightmareGameMode: GameMode;
    beforeEach(() => {
      nightmareGameMode = getGameMode(GameModes.NIGHTMARE);
    });

    it("ends the run at wave 1000, not wave 200", () => {
      expect(nightmareGameMode.isWaveFinal(1000)).toBeTruthy();
      expect(nightmareGameMode.isWaveFinal(200)).toBeFalsy();
    });

    it("treats wave 1000 as the classic-style final boss wave", () => {
      expect(nightmareGameMode.isBattleClassicFinalBoss(1000)).toBeTruthy();
      expect(nightmareGameMode.isBattleClassicFinalBoss(200)).toBeFalsy();
    });

    it("uses 1000 as its skip-detection failsafe wave", () => {
      expect(nightmareGameMode.getClassicFailsafeWave()).toBe(1000);
    });

    it("flags waves 200/400/600/800 as checkpoint bosses but not wave 1000 or non-multiples of 200", () => {
      expect(nightmareGameMode.isNightmareCheckpointBoss(200)).toBeTruthy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(400)).toBeTruthy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(600)).toBeTruthy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(800)).toBeTruthy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(1000)).toBeFalsy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(250)).toBeFalsy();
    });

    it("does not flag checkpoint waves for other modes", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(classicGameMode.isNightmareCheckpointBoss(200)).toBeFalsy();
    });

    it("uses the hardcore mystery encounter wave range", () => {
      expect(nightmareGameMode.getMysteryEncounterLegalWaves()).toEqual([10, 980]);
    });

    it("scales enemy level curve harder than classic", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(nightmareGameMode.getWaveForDifficulty(100)).toBeGreaterThan(classicGameMode.getWaveForDifficulty(100));
    });

    it("offers fewer shop reward slots than classic", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(nightmareGameMode.getBaseModifierCount()).toBeLessThan(classicGameMode.getBaseModifierCount());
    });

    it("gives enemies items less often than classic", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(nightmareGameMode.getEnemyModifierChance(false)).toBeLessThan(
        classicGameMode.getEnemyModifierChance(false),
      );
      expect(nightmareGameMode.getEnemyModifierChance(true)).toBeLessThan(classicGameMode.getEnemyModifierChance(true));
    });

    it("never generates a gym-leader trainer battle on a checkpoint boss wave, regardless of offsetGym", () => {
      // The gym-leader-every-30-waves pattern lands on wave%30===20 when offsetGym is false, or
      // wave%30===0 when true - waves 200/800 (%30===20) and 600 (%30===0) would otherwise collide
      // with it and get hijacked into a trainer battle instead of the intended Eternatus checkpoint
      // fight, since only isWaveFinal(1000) - not the checkpoints - is exempted by default.
      for (const offsetGym of [false, true]) {
        game.scene.offsetGym = offsetGym;
        expect(nightmareGameMode.isWaveTrainer(200)).toBe(false);
        expect(nightmareGameMode.isWaveTrainer(400)).toBe(false);
        expect(nightmareGameMode.isWaveTrainer(600)).toBe(false);
        expect(nightmareGameMode.isWaveTrainer(800)).toBe(false);
      }
    });

    it("still generates gym-leader trainer battles on non-checkpoint waves matching the pattern", () => {
      game.scene.offsetGym = false;
      expect(nightmareGameMode.isWaveTrainer(20)).toBe(true);
      expect(nightmareGameMode.isWaveTrainer(230)).toBe(true);

      game.scene.offsetGym = true;
      expect(nightmareGameMode.isWaveTrainer(30)).toBe(true);
      expect(nightmareGameMode.isWaveTrainer(240)).toBe(true);
    });
  });
});
