import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import { getDexNumber } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Species - MissingNo.", () => {
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
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(20)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  it("should have the configured species data", () => {
    const species = speciesDataRegistry.getSpecies(SpeciesId.MISSING_NO);
    expect(species.type1).toBe(PokemonType.NORMAL);
    expect(species.type2).toBe(PokemonType.FIGHTING);
    expect(species.ability1).toBe(AbilityId.ERROR);
    expect(species.baseStats[Stat.HP]).toBe(150);
    expect(species.baseStats[Stat.ATK]).toBe(150);
    expect(species.baseStats[Stat.DEF]).toBe(150);
    expect(species.baseStats[Stat.SPATK]).toBe(150);
    expect(species.baseStats[Stat.SPDEF]).toBe(150);
    expect(species.baseStats[Stat.SPD]).toBe(150);
    expect(species.malePercent).toBeNull();
    expect(speciesDataRegistry.getPassive(SpeciesId.MISSING_NO, 0)).toBe(AbilityId.NO_GUARD);
  });

  it("should have No Guard's accuracy-bypass effect when its passive is active", async () => {
    // .passiveAbility() forces the passive active regardless of whether it's actually been
    // unlocked with candy on this save - same technique every other passive-behavior test in
    // this file uses.
    game.override.starterSpecies(SpeciesId.MISSING_NO).passiveAbility(AbilityId.NO_GUARD);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const missingno = game.field.getPlayerPokemon();
    expect(missingno.hasAbilityWithAttr("AlwaysHitAbAttr")).toBe(true);
  });

  it("takes exactly 1 damage from a move regardless of its calculated power, including fixed-damage and OHKO moves", async () => {
    game.override.enemySpecies(SpeciesId.MISSING_NO).enemyAbility(AbilityId.ERROR).enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const player = game.field.getPlayerPokemon();
    const missingno = game.field.getEnemyPokemon();

    expect(missingno.getAttackDamage({ source: player, move: allMoves[MoveId.TACKLE] }).damage).toBe(1);
    expect(missingno.getAttackDamage({ source: player, move: allMoves[MoveId.DRAGON_RAGE] }).damage).toBe(1);
    expect(missingno.getAttackDamage({ source: player, move: allMoves[MoveId.FISSURE] }).damage).toBe(1);
  });

  it("takes 0 damage (not 1) from a move it's immune to", async () => {
    game.override.enemySpecies(SpeciesId.MISSING_NO).enemyAbility(AbilityId.ERROR).enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const player = game.field.getPlayerPokemon();
    // MissingNo. is Normal/Fighting - Normal-type Pokemon are immune to Ghost-type moves.
    const missingno = game.field.getEnemyPokemon();

    expect(missingno.getAttackDamage({ source: player, move: allMoves[MoveId.SHADOW_BALL] }).damage).toBe(0);
  });

  it("takes normal, max-HP-proportional damage from poison instead of the fixed-1-damage clamp", async () => {
    game.override
      .enemySpecies(SpeciesId.MISSING_NO)
      .enemyAbility(AbilityId.ERROR)
      .enemyLevel(50)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const missingno = game.field.getEnemyPokemon();
    missingno.trySetStatus(StatusEffect.POISON);
    const startingHp = missingno.hp;

    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();

    // Confirms this isn't blocked outright either - MAGIC_GUARD (which ERROR replaced as
    // MissingNo.'s ability1) would have prevented status damage entirely.
    expect(startingHp - missingno.hp).toBe(toDmgValue(missingno.getMaxHp() / 8));
  });

  it("should be a starter, belong to the Common egg tier, and appear in getAllStarters", () => {
    expect(speciesDataRegistry.isStarter(SpeciesId.MISSING_NO)).toBe(true);
    expect(speciesDataRegistry.getEggTier(SpeciesId.MISSING_NO)).toBe(EggTier.COMMON);
    expect(speciesDataRegistry.getAllStarters()).toContain(SpeciesId.MISSING_NO);
    expect(speciesDataRegistry.getStarterCost(SpeciesId.MISSING_NO)).toBe(1);
  });

  it("should display as dex number 0000, not the generic %2000 mapping's 1000", () => {
    expect(getDexNumber(SpeciesId.MISSING_NO)).toBe(0);
    // A normal species must be unaffected by the override.
    expect(getDexNumber(SpeciesId.BULBASAUR)).toBe(1);
  });

  it("should only know Metronome and Protect at level 5 (nothing else learnable yet)", async () => {
    // starterSpecies forces select-starter-phase's real auto-moveset generation path
    // (PlayerPokemon's constructor only calls generateAndPopulateMoveset() for this override or
    // Daily runs - classicMode.startBattle's test-only party-generation path otherwise leaves
    // moveset empty and expects an explicit .moveset() override instead).
    game.override.starterSpecies(SpeciesId.MISSING_NO).startingLevel(5);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const missingno = game.field.getPlayerPokemon();
    const moveIds = missingno.moveset.map(m => m!.getMove().id);
    expect(moveIds).toContain(MoveId.METRONOME);
    expect(moveIds).toContain(MoveId.PROTECT);
    expect(moveIds.length).toBe(2);
  });

  it("should generate a valid 4-move moveset drawn only from its own learnset by level 45", async () => {
    // generateAndPopulateMoveset() picks semi-randomly from the pool of currently-learnable
    // moves (see ai-moveset-gen.ts) rather than deterministically taking the highest-level ones,
    // so just check every selected move is one MissingNo. can actually know by level 45.
    game.override.starterSpecies(SpeciesId.MISSING_NO).startingLevel(45);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const learnableByLevel45 = [
      MoveId.METRONOME,
      MoveId.PROTECT,
      MoveId.RECOVER,
      MoveId.BODY_SLAM,
      MoveId.HYPER_BEAM,
      MoveId.FINAL_GAMBIT,
      MoveId.SELF_DESTRUCT,
    ];

    const missingno = game.field.getPlayerPokemon();
    const moveIds = missingno.moveset.map(m => m!.getMove().id);
    expect(moveIds.length).toBe(4);
    for (const moveId of moveIds) {
      expect(learnableByLevel45).toContain(moveId);
    }
  });

  it("should use Metronome without crashing", async () => {
    game.override.moveset([MoveId.METRONOME]).enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    game.move.select(MoveId.METRONOME);
    await game.toEndOfTurn();

    // Metronome's move-history entry becomes whatever move it randomly triggered, not
    // Metronome itself - just check the turn resolved with some move actually recorded.
    const missingno = game.field.getPlayerPokemon();
    expect(missingno.getLastXMoves(1)[0]).toBeDefined();
  });

  it("should use Protect to block an incoming attack", async () => {
    game.override.moveset([MoveId.PROTECT]).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const missingno = game.field.getPlayerPokemon();
    const startingHp = missingno.hp;

    game.move.select(MoveId.PROTECT);
    await game.toEndOfTurn();

    expect(missingno.hp).toBe(startingHp);
  });

  it("should use Recover to heal missing HP", async () => {
    // High enough level that several Tackles from the level-20 enemy won't faint it first.
    game.override.moveset([MoveId.RECOVER, MoveId.SPLASH]).enemyMoveset(MoveId.TACKLE).startingLevel(30);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const missingno = game.field.getPlayerPokemon();
    // Take a couple of Tackles first (a single one barely dents its huge bulk) so the missing HP
    // going into Recover's turn is bigger than the one more Tackle it'll eat that same turn -
    // otherwise Recover's heal caps at the (tiny) missing HP and the follow-up hit washes it out.
    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();
    const damagedHp = missingno.hp;
    expect(damagedHp).toBeLessThan(missingno.getMaxHp());

    game.move.select(MoveId.RECOVER);
    await game.toEndOfTurn();

    expect(missingno.hp).toBeGreaterThan(damagedHp);
  });

  it("should use Body Slam to damage the opponent", async () => {
    // NO_GUARD guarantees the hit regardless of Body Slam's own accuracy roll.
    game.override.moveset([MoveId.BODY_SLAM]).enemyMoveset(MoveId.SPLASH).enemyAbility(AbilityId.NO_GUARD);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const enemy = game.field.getEnemyPokemon();
    const startingHp = enemy.hp;

    game.move.select(MoveId.BODY_SLAM);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(startingHp);
  });

  it("should use Hyper Beam to damage the opponent", async () => {
    // NO_GUARD guarantees the hit regardless of Hyper Beam's own accuracy roll.
    game.override.moveset([MoveId.HYPER_BEAM]).enemyMoveset(MoveId.SPLASH).enemyAbility(AbilityId.NO_GUARD);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO);

    const enemy = game.field.getEnemyPokemon();
    const startingHp = enemy.hp;

    game.move.select(MoveId.HYPER_BEAM);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(startingHp);
  });

  it("should use Final Gambit, fainting itself and damaging the opponent by its remaining HP", async () => {
    // A 2nd party member so fainting the active Pokemon doesn't end the run (avoids
    // GameOverPhase, which toEndOfTurn() doesn't expect).
    game.override.moveset([MoveId.FINAL_GAMBIT]).enemyMoveset(MoveId.SPLASH).enemyLevel(100);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO, SpeciesId.MAGIKARP);

    const missingno = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const startingHp = missingno.hp;
    const enemyStartingHp = enemy.hp;

    game.move.select(MoveId.FINAL_GAMBIT);
    await game.phaseInterceptor.to("FaintPhase");

    expect(missingno.isFainted()).toBe(true);
    expect(enemy.hp).toBe(Math.max(0, enemyStartingHp - startingHp));
  });

  it("should use Self-Destruct, fainting itself and damaging the opponent", async () => {
    game.override.moveset([MoveId.SELF_DESTRUCT]).enemyMoveset(MoveId.SPLASH).enemyLevel(100);
    await game.classicMode.startBattle(SpeciesId.MISSING_NO, SpeciesId.MAGIKARP);

    const missingno = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const enemyStartingHp = enemy.hp;

    game.move.select(MoveId.SELF_DESTRUCT);
    await game.phaseInterceptor.to("FaintPhase");

    expect(missingno.isFainted()).toBe(true);
    expect(enemy.hp).toBeLessThan(enemyStartingHp);
  });
});
