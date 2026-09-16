import type { GameMode } from "#app/game-mode";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import * as Messages from "#app/messages";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import type { Pokemon } from "#field/pokemon";
import { getPartyLuckValue } from "#modifiers/modifier-type";
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

    it("flags waves 200/400/600 as Eternatus checkpoint bosses but not 1000/other waves", () => {
      expect(nightmareGameMode.isNightmareCheckpointBoss(200)).toBeTruthy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(400)).toBeTruthy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(600)).toBeTruthy();
      // 1000 is always the forced Arceus Trial, never an Eternatus checkpoint.
      expect(nightmareGameMode.isNightmareCheckpointBoss(1000)).toBeFalsy();
      expect(nightmareGameMode.isNightmareCheckpointBoss(250)).toBeFalsy();
    });

    it("flags wave 800 as an Eternatus checkpoint only when Dialga/Palkia/Giratina aren't all registered starters", () => {
      // No starting party set up - none of the trio are registered starters, so wave 800 falls back
      // to being a checkpoint like wave 600 (see hasCreationTrioUnlocked()).
      expect(nightmareGameMode.isNightmareCheckpointBoss(800)).toBeTruthy();

      for (const species of [SpeciesId.DIALGA, SpeciesId.PALKIA, SpeciesId.GIRATINA]) {
        game.scene.gameData.dexData[species].caughtAttr = DexAttr.NON_SHINY;
      }
      expect(nightmareGameMode.isNightmareCheckpointBoss(800)).toBeFalsy();
    });

    it("does not flag checkpoint waves for other modes", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(classicGameMode.isNightmareCheckpointBoss(200)).toBeFalsy();
    });

    it("only allows the Eternatus checkpoint to reach its second (Eternamax) phase at wave 600", () => {
      expect(nightmareGameMode.isNightmarePhaseTwoWave(200)).toBeFalsy();
      expect(nightmareGameMode.isNightmarePhaseTwoWave(400)).toBeFalsy();
      expect(nightmareGameMode.isNightmarePhaseTwoWave(600)).toBeTruthy();
      expect(nightmareGameMode.isNightmarePhaseTwoWave(1000)).toBeFalsy();

      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(classicGameMode.isNightmarePhaseTwoWave(600)).toBeFalsy();
    });

    it("forces the Arceus Trial at wave 1000, and Adeus at wave 800 only when the creation trio is registered", () => {
      // No trio registered yet - wave 800 falls back to null (an Eternatus checkpoint instead).
      expect(nightmareGameMode.getFixedMysteryEncounterType(800)).toBeNull();
      expect(nightmareGameMode.getFixedMysteryEncounterType(1000)).toBe(MysteryEncounterType.ARCEUS_TRIAL);
      expect(nightmareGameMode.getFixedMysteryEncounterType(200)).toBeNull();
      expect(nightmareGameMode.getFixedMysteryEncounterType(600)).toBeNull();

      for (const species of [SpeciesId.DIALGA, SpeciesId.PALKIA, SpeciesId.GIRATINA]) {
        game.scene.gameData.dexData[species].caughtAttr = DexAttr.NON_SHINY;
      }
      expect(nightmareGameMode.getFixedMysteryEncounterType(800)).toBe(MysteryEncounterType.ADEUS_ENCOUNTER);

      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(classicGameMode.getFixedMysteryEncounterType(800)).toBeNull();
      expect(classicGameMode.getFixedMysteryEncounterType(1000)).toBeNull();
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

    it("never generates a gym-leader trainer battle on an Eternatus checkpoint wave, regardless of offsetGym", () => {
      // The gym-leader-every-30-waves pattern lands on wave%30===20 when offsetGym is false, or
      // wave%30===0 when true - waves 200 (%30===20) and 600 (%30===0) would otherwise collide
      // with it and get hijacked into a trainer battle instead of the intended Eternatus checkpoint
      // fight, since only isWaveFinal(1000) - not the checkpoints - is exempted by default.
      for (const offsetGym of [false, true]) {
        game.scene.offsetGym = offsetGym;
        expect(nightmareGameMode.isWaveTrainer(200)).toBe(false);
        expect(nightmareGameMode.isWaveTrainer(400)).toBe(false);
        expect(nightmareGameMode.isWaveTrainer(600)).toBe(false);
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

    it("pays out 30% of the money reward of classic on a battle win", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      expect(nightmareGameMode.getMoneyRewardMultiplier()).toBe(0.3);
      expect(classicGameMode.getMoneyRewardMultiplier()).toBe(1);
    });

    it("docks 3 off the party's effective luck value compared to classic, clamped at 0", () => {
      const party = [
        { isAllowedInBattle: () => true, species: { speciesId: SpeciesId.BULBASAUR }, getLuck: () => 10 },
      ] as unknown as Pokemon[];

      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      expect(getPartyLuckValue(party)).toBe(10);

      game.scene.gameMode = nightmareGameMode;
      expect(getPartyLuckValue(party)).toBe(7);

      const lowLuckParty = [
        { isAllowedInBattle: () => true, species: { speciesId: SpeciesId.BULBASAUR }, getLuck: () => 2 },
      ] as unknown as Pokemon[];
      expect(getPartyLuckValue(lowLuckParty)).toBe(0);
    });

    it("gives bosses one extra health segment compared to classic", () => {
      const wave = 50;
      const level = 50;
      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      const classicSegments = game.scene.getEncounterBossSegments(wave, level);

      game.scene.gameMode = nightmareGameMode;
      const nightmareSegments = game.scene.getEncounterBossSegments(wave, level);

      expect(nightmareSegments).toBe(classicSegments + 1);
    });

    it("gives trainer waves a 1-in-4 chance to roll as a boss trainer even off the every-30-waves gym slot", () => {
      const classicGameMode = getGameMode(GameModes.CLASSIC);
      // wave 21 with offsetGym=false doesn't match either mode's wave%30===20 gym-slot pattern.
      const wave = 21;

      vi.spyOn(Utils, "randSeedInt").mockReturnValue(0); // !randSeedInt(4) -> true
      expect(nightmareGameMode.isTrainerBoss(wave, BiomeId.PLAINS, false)).toBe(true);
      expect(classicGameMode.isTrainerBoss(wave, BiomeId.PLAINS, false)).toBe(false);

      vi.spyOn(Utils, "randSeedInt").mockReturnValue(1); // !randSeedInt(4) -> false
      expect(nightmareGameMode.isTrainerBoss(wave, BiomeId.PLAINS, false)).toBe(false);
    });

    it("skews non-boss trainer flavor away from Common toward rarer tiers, without touching wild species rarity", () => {
      const arena = game.scene.arena as unknown as {
        generateNonBossTrainerTier: (tierValue: number) => BiomePoolTier;
        generateNonBossBiomeTier: (tierValue: number) => BiomePoolTier;
      };

      // Boundaries of the Nightmare-only 170/200/65/60/17 (of 512) trainer table.
      expect(arena.generateNonBossTrainerTier(341)).toBe(BiomePoolTier.UNCOMMON);
      expect(arena.generateNonBossTrainerTier(342)).toBe(BiomePoolTier.COMMON);
      expect(arena.generateNonBossTrainerTier(141)).toBe(BiomePoolTier.RARE);
      expect(arena.generateNonBossTrainerTier(142)).toBe(BiomePoolTier.UNCOMMON);
      expect(arena.generateNonBossTrainerTier(76)).toBe(BiomePoolTier.SUPER_RARE);
      expect(arena.generateNonBossTrainerTier(77)).toBe(BiomePoolTier.RARE);
      expect(arena.generateNonBossTrainerTier(16)).toBe(BiomePoolTier.ULTRA_RARE);
      expect(arena.generateNonBossTrainerTier(17)).toBe(BiomePoolTier.SUPER_RARE);

      // The original 339/118/25/25/5 (of 512) wild species table is untouched.
      expect(arena.generateNonBossBiomeTier(172)).toBe(BiomePoolTier.UNCOMMON);
      expect(arena.generateNonBossBiomeTier(173)).toBe(BiomePoolTier.COMMON);
    });

    it("uses the Nightmare-only trainer tier table (not the wild species one) when generating a trainer's flavor", () => {
      const arena = game.scene.arena as unknown as {
        generateNonBossTrainerTier: (tierValue: number) => BiomePoolTier;
        generateNonBossBiomeTier: (tierValue: number) => BiomePoolTier;
      };
      const trainerTierSpy = vi.spyOn(arena, "generateNonBossTrainerTier");
      const biomeTierSpy = vi.spyOn(arena, "generateNonBossBiomeTier");
      // Keeps isTrainerBoss's extra roll from firing and pins the tierValue roll, so this wave
      // deterministically takes the non-boss branch under test.
      vi.spyOn(Utils, "randSeedInt").mockReturnValue(1);

      game.scene.gameMode = nightmareGameMode;
      game.scene.arena.randomTrainerType(21);
      expect(trainerTierSpy).toHaveBeenCalled();
      expect(biomeTierSpy).not.toHaveBeenCalled();

      trainerTierSpy.mockClear();
      biomeTierSpy.mockClear();

      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      game.scene.arena.randomTrainerType(21);
      expect(biomeTierSpy).toHaveBeenCalled();
      expect(trainerTierSpy).not.toHaveBeenCalled();
    });

    it("gives trainer-owned Pokemon perfect (6V) IVs, unlike classic", () => {
      // addEnemyPokemon's init() calls into UI code that reads currentBattle, which is null here.
      vi.spyOn(Messages, "getPokemonNameWithAffix").mockReturnValue("");
      const species = speciesDataRegistry.getSpecies(SpeciesId.MAGIKARP);

      game.scene.gameMode = nightmareGameMode;
      const nightmareTrainerMon = game.scene.addEnemyPokemon(species, 50, TrainerSlot.TRAINER);
      expect(nightmareTrainerMon.ivs).toEqual([31, 31, 31, 31, 31, 31]);

      game.scene.gameMode = getGameMode(GameModes.CLASSIC);
      const classicTrainerMon = game.scene.addEnemyPokemon(species, 50, TrainerSlot.TRAINER);
      expect(classicTrainerMon.ivs).not.toEqual([31, 31, 31, 31, 31, 31]);
    });

    it("does not force 6V IVs on wild (non-trainer) Nightmare Pokemon", () => {
      vi.spyOn(Messages, "getPokemonNameWithAffix").mockReturnValue("");
      game.scene.gameMode = nightmareGameMode;
      const wildMon = game.scene.addEnemyPokemon(
        speciesDataRegistry.getSpecies(SpeciesId.MAGIKARP),
        50,
        TrainerSlot.NONE,
      );
      expect(wildMon.ivs).not.toEqual([31, 31, 31, 31, 31, 31]);
    });
  });
});
