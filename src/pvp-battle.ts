/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PvP battle construction & sync context (Stage A + B). Once a room reaches "battling" (see
 * pvp-room.ts's initiatePvpBattle), each client independently constructs a real local Battle —
 * "my" 3 chosen Pokemon as actual PlayerPokemon, the opponent's 3 chosen Pokemon as actual
 * EnemyPokemon (built from their Starter data, pulled from Firestore) — seeded with the same
 * shared RNG seed. Both clients then run the real, unmodified single-player battle engine
 * (MovePhase, TurnStartPhase, damage calc, animations, ...); the only thing that differs from a
 * normal battle is where the "enemy" side's per-turn command comes from — see
 * phases/pvp-enemy-command-phase.ts, which waits for the opponent's real client to submit a
 * command via Firestore instead of running AI. Because both sides start from identical parties
 * and an identical seed, and every turn's inputs are exchanged before being applied, both
 * screens compute the same result independently ("lockstep") — nobody's client is a passive
 * spectator, but nobody is authoritative over the other either.
 *
 * Every Pokemon on both sides is built via an explicit PokemonData "dataSource" (see
 * buildPvpPokemon below) rather than letting addPlayerPokemon/addEnemyPokemon generate any of
 * ability/form/gender/shiny/variant/ivs/nature/id themselves — those generation paths draw from
 * the RNG stream, and since "my" Pokemon and "the opponent's" Pokemon are built through
 * (necessarily) different code paths on each client, letting either side roll randomness during
 * construction would desync the two clients' RNG streams before the battle even starts. A full
 * dataSource sidesteps this entirely: every field is explicit, so construction consumes zero RNG
 * on both sides, symmetrically.
 *
 * Deliberately bypasses globalScene.newBattle() (see battle-scene.ts) rather than reusing it —
 * that function is heavily coupled to real run/wave progression (auto-incrementing wave index,
 * clearing the previous battle's real state, etc.), none of which applies to a one-off scripted
 * battle constructed directly from two accounts' standing PvP rosters.
 */

import { Battle } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { PvpRoomWithId } from "#app/pvp-room";
import { loadPvpTeam } from "#app/pvp-team";
import { Gender } from "#data/gender";
import { BattleType } from "#enums/battle-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { getModifierTypeFuncById, type ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { PokemonData } from "#system/pokemon-data";
import type { Starter } from "#types/save-data";

/** Fixed wave index used for every PvP battle's seed derivation — arbitrary but must be the same on both clients (it is, since it's a constant, not read from any run state). */
const PVP_WAVE_INDEX = 1;

interface PvpBattleContext {
  roomId: string;
  isHost: boolean;
}

let activeContext: PvpBattleContext | null = null;
/** Reset at the start of every startPvpBattle() call — only needs to be unique within one battle's 6 Pokemon. */
let nextPvpPokemonId = 1;

/** The room/side info for the currently-running PvP battle, if any — read by PvpEnemyCommandPhase and CommandPhase's PvP hook. */
export function getPvpBattleContext(): PvpBattleContext | null {
  return activeContext;
}

/** Clears the active PvP battle context. Call once the battle ends (or is aborted) so a later real run isn't mistaken for a PvP battle. */
export function clearPvpBattleContext(): void {
  activeContext = null;
}

/** Attaches a Starter's held item (if any) to the given Pokemon, mirroring modifier.ts's overrideHeldItems(). */
function applyPvpHeldItem(pokemon: Pokemon, heldItem: NonNullable<Starter["heldItem"]>, isPlayerSide: boolean): void {
  const modifierFunc = getModifierTypeFuncById(heldItem.typeId);
  if (!modifierFunc) {
    return;
  }
  let modifierType: ModifierType | null = modifierFunc();
  if (modifierType instanceof ModifierTypeGenerator) {
    modifierType = modifierType.generateType([], heldItem.pregenArgs);
  }
  const heldItemModifier =
    modifierType && (modifierType.withIdFromFunc(modifierFunc).newModifier(pokemon) as PokemonHeldItemModifier);
  if (!heldItemModifier) {
    return;
  }
  heldItemModifier.pokemonId = pokemon.id;
  if (isPlayerSide) {
    globalScene.addModifier(heldItemModifier, true, false, false, true);
  } else {
    globalScene.addEnemyModifier(heldItemModifier, true, true);
  }
}

/**
 * Builds one real battle Pokemon from a registered Starter. Constructs via an explicit
 * PokemonData dataSource (see file header for why) rather than the normal
 * random-then-override approach, so calculateStats() must be called manually afterward — the
 * dataSource path skips the constructor's own auto-calculation entirely.
 */
function buildPvpPokemon(starter: Starter, isPlayerSide: boolean): PlayerPokemon | EnemyPokemon {
  const species = speciesDataRegistry.getSpecies(starter.speciesId);
  const gender = species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
  const level = starter.level ?? 100;

  const dataSource = new PokemonData({
    id: nextPvpPokemonId++,
    species: starter.speciesId,
    formIndex: starter.formIndex,
    abilityIndex: starter.abilityIndex,
    passive: starter.passive,
    shiny: starter.shiny,
    variant: starter.variant,
    gender,
    level,
    // Placeholder stats/hp — addPlayerPokemon()/addEnemyPokemon() call pokemon.init() internally,
    // which touches getMaxHp()/getHpRatio() (for the battle-info HP bar) before we get a chance to
    // call calculateStats() on the returned instance, so `stats` can't be left undefined here or
    // that crashes. hp:1 with stats[HP]:1 reads as "100% HP" — calculateStats()'s own
    // level-up-style HP rescaling (`hp += newMaxHp - oldMaxHp`) then correctly carries that same
    // 100%-of-max ratio over to the real computed max HP once we call it below.
    stats: [1, 1, 1, 1, 1, 1],
    hp: 1,
    ivs: starter.ivs,
    nature: starter.nature,
    pauseEvolutions: !!starter.pauseEvolutions,
    pokerus: starter.pokerus,
    teraType: starter.teraType ?? species.type1,
    nickname: starter.nickname,
  });

  // PlayerPokemon's constructor (unlike EnemyPokemon's) does NOT auto-extract abilityIndex/
  // formIndex/gender/shiny/variant from a dataSource — it only forwards whatever's passed as a
  // direct param. EnemyPokemon's constructor DOES auto-extract those five from dataSource, so
  // passing them a second time as direct params isn't possible there (addEnemyPokemon() doesn't
  // expose them) nor necessary. ivs/nature are fine either way since both constructors' shared
  // dataSource branch sets those from dataSource unconditionally.
  const pokemon: PlayerPokemon | EnemyPokemon = isPlayerSide
    ? globalScene.addPlayerPokemon(
        species,
        level,
        starter.abilityIndex,
        starter.formIndex,
        gender,
        starter.shiny,
        starter.variant,
        undefined,
        undefined,
        dataSource,
      )
    : globalScene.addEnemyPokemon(species, level, TrainerSlot.TRAINER, false, false, dataSource);

  // The dataSource path above skips the constructor's own stats/HP calculation entirely (it just
  // copies whatever the dataSource carried, which we deliberately left blank) — compute them for
  // real now. calculateStats() is purely a function of species/ivs/nature/level/modifiers, no RNG.
  pokemon.calculateStats();

  if (starter.moveset) {
    // ignoreValidate=true: PvP-registered movesets are drawn from the species' FULL movepool
    // (see choosePvpMoveset() in starter-select-ui-handler.ts), not the normal starter-select
    // screen's egg-move-gated pool that validateStarterMoveset() checks against — and for the
    // opponent's Pokemon specifically, that check would incorrectly run against the LOCAL
    // player's own dex/starter data rather than the opponent's.
    pokemon.tryPopulateMoveset(starter.moveset, true);
  }
  pokemon.setVisible(false);

  if (starter.heldItem) {
    applyPvpHeldItem(pokemon, starter.heldItem, isPlayerSide);
  }

  return pokemon;
}

/**
 * Constructs and launches a real local battle for a room that has just reached "battling" (both
 * team-preview picks in, shared pvpSeed written — see pvp-room.ts's initiatePvpBattle). Only
 * allowed from the title screen (no run in progress) — a PvP battle must never touch/mutate the
 * real save file, and the simplest way to guarantee that is to never run one alongside a real
 * currentBattle in the first place.
 */
export async function startPvpBattle(
  room: PvpRoomWithId,
  isHost: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (globalScene.currentBattle != null) {
    return { ok: false, reason: "런이 진행 중입니다. 타이틀 화면으로 돌아가 다시 시도해주세요." };
  }
  if (!room.pvpSeed || !room.hostPicks || !room.guestPicks) {
    return { ok: false, reason: "대전 준비가 아직 완료되지 않았습니다." };
  }

  const [hostTeam, guestTeam] = await Promise.all([loadPvpTeam(room.hostUid), loadPvpTeam(room.guestUid)]);
  if (!hostTeam || !guestTeam) {
    return { ok: false, reason: "팀 정보를 불러오지 못했습니다." };
  }
  const hostStarters = room.hostPicks.map(i => hostTeam[i]).filter((s): s is Starter => !!s);
  const guestStarters = room.guestPicks.map(i => guestTeam[i]).filter((s): s is Starter => !!s);
  if (hostStarters.length !== 3 || guestStarters.length !== 3) {
    return { ok: false, reason: "선출된 포켓몬 정보가 올바르지 않습니다." };
  }

  nextPvpPokemonId = 1;
  globalScene.setSeed(room.pvpSeed);
  globalScene.resetSeed(PVP_WAVE_INDEX);

  let battle!: Battle;
  let trainer!: Trainer;
  globalScene.executeWithSeedOffset(
    () => {
      trainer = new Trainer(TrainerType.ACE_TRAINER, TrainerVariant.DEFAULT);
      battle = new Battle(globalScene.gameMode, {
        waveIndex: PVP_WAVE_INDEX,
        battleType: BattleType.TRAINER,
        trainer,
        double: false,
      });
    },
    PVP_WAVE_INDEX << 3,
    globalScene.waveSeed,
  );
  trainer.name = (isHost ? room.guestName : room.hostName) ?? trainer.name;
  globalScene.field.add(trainer);

  battle.isPvpBattle = true;
  battle.enemyLevels = (isHost ? guestStarters : hostStarters).map(s => s.level ?? 100);

  // Pokemon construction below (specifically EnemyPokemon#init() -> battle-info UI setup) reads
  // globalScene.currentBattle internally (e.g. to decide on final-boss name styling) — must be
  // assigned before building anyone, not after.
  globalScene.currentBattle = battle;

  // Build in a fixed order (host's picks, then guest's picks) on BOTH clients regardless of which
  // side is "mine" locally, so the two clients' RNG streams (and pokemon id assignment) advance in
  // the same order either way.
  const party = globalScene.getPlayerParty();
  for (const starter of hostStarters) {
    const pokemon = buildPvpPokemon(starter, isHost);
    if (isHost) {
      party.push(pokemon as PlayerPokemon);
    } else {
      battle.enemyParty.push(pokemon as EnemyPokemon);
    }
  }
  for (const starter of guestStarters) {
    const pokemon = buildPvpPokemon(starter, !isHost);
    if (isHost) {
      battle.enemyParty.push(pokemon as EnemyPokemon);
    } else {
      party.push(pokemon as PlayerPokemon);
    }
  }

  await Promise.all([...party, ...battle.enemyParty].map(p => p.loadAssets()));

  activeContext = { roomId: room.id, isHost };

  globalScene.phaseManager.pushNew("EncounterPhase", true);

  return { ok: true };
}
