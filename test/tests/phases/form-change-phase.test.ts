import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Form Change Phase", () => {
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
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("Zacian should successfully change into Crowned form", async () => {
    await game.classicMode.startBattle(SpeciesId.ZACIAN);

    // Before the form change: Should be Hero form
    const zacian = game.field.getPlayerPokemon();
    expect(zacian.getFormKey()).toBe("hero-of-many-battles");
    expect(zacian.getTypes()).toStrictEqual([PokemonType.FAIRY]);
    expect(zacian.calculateBaseStats()).toStrictEqual([92, 120, 115, 80, 115, 138]);

    // Give Zacian a Rusted Sword
    const rustedSwordType = generateModifierType(modifierTypes.RARE_FORM_CHANGE_ITEM)!;
    const rustedSword = rustedSwordType.newModifier(zacian);
    await game.scene.addModifier(rustedSword);

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    // After the form change: Should be Crowned form
    expect(game.phaseInterceptor.log.includes("FormChangePhase")).toBe(true);
    expect(zacian.getFormKey()).toBe("crowned");
    expect(zacian.getTypes()).toStrictEqual([PokemonType.FAIRY, PokemonType.STEEL]);
    expect(zacian.calculateBaseStats()).toStrictEqual([92, 150, 115, 80, 115, 148]);
  });

  it("modal FormChangePhase should complete (not hang) when run against an EnemyPokemon", async () => {
    // PvP mirrors an opponent's item-triggered form change (e.g. Mega Evolution) with the exact
    // same modal FormChangePhase the local player's own reveal uses - see
    // pvp-battle.ts's createPvpFormChangeRevealPhase(), which constructs it with an EnemyPokemon
    // cast to PlayerPokemon (a TS-only cast; at runtime it's a genuine EnemyPokemon).
    // doEvolution() calls this.pokemon.getPossibleForm(), which used to live only on
    // PlayerPokemon: for a real EnemyPokemon that threw an uncaught
    // "getPossibleForm is not a function" TypeError inside an unawaited promise chain, which
    // silently stalled the phase queue forever (visible in-game as the evolution background stuck
    // on screen with only the "changed form!"/mega evolution message showing, never resolving).
    game.override.enemySpecies(SpeciesId.ZACIAN);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const enemyZacian = game.field.getEnemyPokemon();
    expect(enemyZacian.getFormKey()).toBe("hero-of-many-battles");

    const formChange = speciesDataRegistry.getFormChanges(SpeciesId.ZACIAN).find(fc => fc.formKey === "crowned")!;
    expect(formChange).toBeDefined();

    globalScene.phaseManager.unshiftPhase(
      globalScene.phaseManager.create("FormChangePhase", enemyZacian as unknown as PlayerPokemon, formChange, true),
    );

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("FormChangePhase");
    await game.phaseInterceptor.to("TurnStartPhase");

    expect(enemyZacian.getFormKey()).toBe("crowned");
  });
});
