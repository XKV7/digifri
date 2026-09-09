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
import type { Phase } from "#app/phase";
import type { PvpRoomWithId } from "#app/pvp-room";
import { submitPvpFormChangeState, subscribePvpFormChangeState } from "#app/pvp-room";
import { loadPvpTeam } from "#app/pvp-team";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import type { SpeciesFormChange } from "#data/pokemon-forms";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import type { PokemonFormChangeItemModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { getModifierTypeFuncById, type ModifierType, ModifierTypeGenerator } from "#modifiers/modifier-type";
import { PokemonData } from "#system/pokemon-data";
import type { Starter } from "#types/save-data";

/** Fixed biome used for every PvP battle's arena — arbitrary but must be the same on both clients (it is, since it's a constant, not read from any run state). */
const PVP_BIOME = BiomeId.TOWN;

/** Fixed wave index used for every PvP battle's seed derivation — arbitrary but must be the same on both clients (it is, since it's a constant, not read from any run state). */
const PVP_WAVE_INDEX = 1;

interface PvpBattleContext {
  roomId: string;
  isHost: boolean;
}

let activeContext: PvpBattleContext | null = null;
/** Reset at the start of every startPvpBattle() call — only needs to be unique within one battle's 6 Pokemon. */
let nextPvpPokemonId = 1;
/** Whether this (local) side has already used its one form-change-item activation for the current battle — see togglePvpFormChangeItem. Reset at the start of every startPvpBattle() call. */
let pvpFormChangeUsed = false;

interface PendingPvpFormChangeReveal {
  pokemon: Pokemon;
  formChange: SpeciesFormChange;
}
/**
 * Form changes (Mega Evolution etc.) toggled so far this turn, on either side, waiting to actually
 * play at turn start — see queuePvpFormChangeReveal and turn-start-phase.ts's PvP branch. Reset at
 * the start of every startPvpBattle() call and drained (emptied) every time turn-start-phase.ts
 * reads it.
 */
let pendingFormChangeReveals: PendingPvpFormChangeReveal[] = [];

/** The room/side info for the currently-running PvP battle, if any — read by PvpEnemyCommandPhase and CommandPhase's PvP hook. */
export function getPvpBattleContext(): PvpBattleContext | null {
  return activeContext;
}

/** Clears the active PvP battle context. Call once the battle ends (or is aborted) so a later real run isn't mistaken for a PvP battle. */
export function clearPvpBattleContext(): void {
  activeContext = null;
}

function getPvpFormChangeItemModifiers(pokemon: Pokemon): PokemonFormChangeItemModifier[] {
  // globalScene.findModifiers() defaults to isPlayer=true (searching only globalScene.modifiers,
  // never globalScene.enemyModifiers) - fine for togglePvpFormChangeItem's own local Pokemon, but
  // applyPvpFormChangeState calls this with an EnemyPokemon (the opponent's mirrored view), whose
  // held-item modifier was attached via addEnemyModifier() and so only ever lives in
  // enemyModifiers. Without passing pokemon.isPlayer() through explicitly, that lookup always
  // returned empty for the enemy side, silently no-opping the whole function before it ever got
  // to applying the form change - the actual reason the opponent's Mega Evolution never appeared,
  // not the phase-timing issue this file's own history previously (wrongly) blamed it on.
  return globalScene.findModifiers(
    m => m.is("PokemonFormChangeItemModifier") && m.pokemonId === pokemon.id,
    pokemon.isPlayer(),
  ) as PokemonFormChangeItemModifier[];
}

/**
 * Whether the given Pokemon holds a form-change item (Mega Stone, Blue/Red Orb, ...) registered
 * via PvP team registration AND this side hasn't already used its one form-change activation for
 * the battle (real Mega Evolution is limited to once per trainer per battle, regardless of how
 * many of that trainer's Pokemon carry a qualifying item — see pvpFormChangeUsed) — gates whether
 * the command menu's repurposed Tera slot shows for it (see command-ui-handler.ts's canTera()).
 */
export function hasPvpFormChangeItem(pokemon: Pokemon): boolean {
  return !pvpFormChangeUsed && getPvpFormChangeItemModifiers(pokemon).length > 0;
}

/** The "items" spritesheet frame name for the given Pokemon's registered form-change item (the same icon shown in the shop/party screen — see Modifier.getIcon() in modifier.ts), or null if it has none. Used to show the actual item on the command menu's repurposed Tera slot instead of a type icon. */
export function getPvpFormChangeItemIcon(pokemon: Pokemon): string | null {
  const modifiers = getPvpFormChangeItemModifiers(pokemon);
  return modifiers.length > 0 ? modifiers[0].type.iconImage : null;
}

/**
 * Finds the SpeciesFormChange matching the given item modifiers' held item(s) and the target
 * active state, queuing it to actually play at turn start (see drainPendingPvpFormChangeReveals)
 * instead of immediately — real Mega Evolution reveals happen at the start of the turn, in Speed
 * order if both sides are doing it the same turn, not the instant either side declares it. Any
 * earlier still-pending reveal for the same Pokemon this turn is replaced (not stacked), so
 * rapidly toggling on/off/on before submitting a move only plays the final state once.
 *
 * Deliberately doesn't use fc.canChange(pokemon) here (see SpeciesFormChangeItemTrigger.canChange
 * in form-change-triggers.ts) - it looks up the matching modifier via globalScene.findModifier()
 * with no explicit isPlayer argument, which defaults to true and so always comes back empty for an
 * EnemyPokemon. The pokemonId/item/active match it's checking for is instead done directly against
 * `modifiers`, which the caller already fetched with the correct isPlayer() awareness.
 */
function queuePvpFormChangeReveal(pokemon: Pokemon, modifiers: PokemonFormChangeItemModifier[], active: boolean): void {
  const heldItemIds = new Set(modifiers.map(m => m.formChangeItem));
  const formChange = speciesDataRegistry.getFormChanges(pokemon.species.speciesId).find(fc => {
    const trigger = fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger | undefined;
    return trigger && heldItemIds.has(trigger.item) && trigger.active === active;
  });
  if (!formChange) {
    return;
  }
  pendingFormChangeReveals = pendingFormChangeReveals.filter(r => r.pokemon !== pokemon);
  pendingFormChangeReveals.push({ pokemon, formChange });
}

/**
 * Drains (returns and clears) every form change queued this turn via queuePvpFormChangeReveal, on
 * either side. Called once by turn-start-phase.ts's PvP branch, right before the turn's moves are
 * ordered and resolved.
 */
export function drainPendingPvpFormChangeReveals(): PendingPvpFormChangeReveal[] {
  const reveals = pendingFormChangeReveals;
  pendingFormChangeReveals = [];
  return reveals;
}

/**
 * Builds the actual reveal Phase for one queued form change — the full-screen "MEGA EVOLUTION!"
 * cutscene (FormChangePhase) unless the form change is marked quiet, matching what
 * globalScene.triggerPokemonFormChange() itself picks for `pokemon.isPlayer()`. Constructing
 * FormChangePhase with an EnemyPokemon needs a type assertion (its constructor is typed for
 * PlayerPokemon specifically) — verified safe: the modal/item-triggered path it takes (evolution:
 * null, so doEvolution() is fully overridden by FormChangePhase's own tween sequence) never
 * touches anything PlayerPokemon-only like getPlayerParty()/party-slot lookups (those only run
 * from EvolutionPhase's real level-up-evolution code, a different method FormChangePhase never
 * calls), and its setMode() uses ui.setOverlayMode() rather than replacing the UI stack outright,
 * so it doesn't clobber whatever the *other* side's player happens to be doing underneath when
 * their reveal's turn comes up — it plays on top and correctly reverts back to exactly that once
 * it ends.
 */
export function createPvpFormChangeRevealPhase(reveal: PendingPvpFormChangeReveal): Phase {
  return reveal.formChange.quiet
    ? globalScene.phaseManager.create("QuietFormChangePhase", reveal.pokemon, reveal.formChange)
    : globalScene.phaseManager.create("FormChangePhase", reveal.pokemon as PlayerPokemon, reveal.formChange, true);
}

/**
 * Toggles the given (local, player-controlled) Pokemon's form-change item active/inactive and
 * broadcasts the new state to the opponent's client (see PvpRoom.hostFormChangeState) so it can
 * mirror it on its view of this same Pokemon — necessary since the form change can alter
 * stats/types that both clients' damage calculations must agree on. Called from
 * command-ui-handler.ts's repurposed Tera button; a no-op if the Pokemon has no such item or this
 * side has already used its one activation for the battle. Activating (not deactivating)
 * permanently consumes that one-per-battle use, matching real Mega Evolution — once used,
 * hasPvpFormChangeItem() stops offering the button at all for the rest of the battle, on any of
 * this side's Pokemon.
 *
 * The item's active flag is set immediately (so this side's own move-selection screen reflects it
 * right away), but the actual form change — and its animation — doesn't play until turn start (see
 * queuePvpFormChangeReveal), same as the opponent's mirrored side.
 */
export function togglePvpFormChangeItem(pokemon: Pokemon): void {
  if (pvpFormChangeUsed) {
    return;
  }
  const modifiers = getPvpFormChangeItemModifiers(pokemon);
  if (modifiers.length === 0) {
    return;
  }
  const active = !modifiers[0].active;
  for (const modifier of modifiers) {
    modifier.active = active;
  }
  if (active) {
    pvpFormChangeUsed = true;
  }
  queuePvpFormChangeReveal(pokemon, modifiers, active);

  const ctx = activeContext;
  if (ctx) {
    void submitPvpFormChangeState(ctx.roomId, ctx.isHost, pokemon.id, active);
  }
}

/**
 * Applies a form-change-item active state received from the opponent's client to the given
 * (local view of their) Pokemon. No-ops if already in sync or the Pokemon has no such item,
 * since this is called on every room update, not just relevant ones (see
 * subscribePvpFormChangeState). Like the local toggle above, only sets the modifier's active flag
 * now — the actual reveal is queued for turn start (see queuePvpFormChangeReveal) so it can be
 * ordered against a same-turn Mega Evolution on the other side by Speed.
 */
function applyPvpFormChangeState(pokemon: Pokemon, active: boolean): void {
  const modifiers = getPvpFormChangeItemModifiers(pokemon);
  if (modifiers.length === 0 || modifiers[0].active === active) {
    return;
  }
  for (const modifier of modifiers) {
    modifier.active = active;
  }
  queuePvpFormChangeReveal(pokemon, modifiers, active);
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
  if (heldItemModifier.is("PokemonFormChangeItemModifier")) {
    // FormChangeItemModifierType's factory (see modifier-type.ts) always constructs these with
    // active:true, which is fine for a normal run (an item picked up mid-run applies right away)
    // but wrong here: nothing in startPvpBattle() ever calls triggerPokemonFormChange() for the
    // initial state, so the Pokemon would silently enter battle in its base form while this flag
    // claims it's already active - then a player's first press of the repurposed Tera button
    // (see command-ui-handler.ts/togglePvpFormChangeItem) would flip it to false and do nothing
    // visible, confusingly requiring a second press to actually activate the form. Force it off
    // so PvP Pokemon always start in their base form, consistent with needing an explicit toggle.
    heldItemModifier.active = false;
  }
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
  pvpFormChangeUsed = false;
  pendingFormChangeReveals = [];
  globalScene.setSeed(room.pvpSeed);
  globalScene.resetSeed(PVP_WAVE_INDEX);

  // A PvP battle is launched straight from the title screen rather than via newArena()/newBattle()
  // (see below), so give it its own explicit, guaranteed-clean arena instead of depending on
  // whatever globalScene.arena happens to be left over from the last real run/reset(). Doesn't
  // touch the shared RNG stream (Arena's constructor/init() are both purely deterministic), so
  // calling this here doesn't need to be wrapped in executeWithSeedOffset like the Battle/Trainer
  // construction below.
  await globalScene.loadBiomeAssets(PVP_BIOME);
  globalScene.newArena(PVP_BIOME);
  globalScene.arena.init();

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
  // Held items still apply their effects normally in PvP - this only hides the icon bars for
  // both sides, so players can't see what item their opponent (or they themselves) picked.
  // Re-shown by PvpBattleEndPhase once the battle is over.
  globalScene.setModifiersVisible(false);
  battle.enemyLevels = (isHost ? guestStarters : hostStarters).map(s => s.level ?? 100);
  // Battle#turnCommands (and #preTurnCommands/#battleSeedState) are declared on the class but only
  // ever actually assigned inside incrementTurn() (see battle.ts) — every real battle gets this for
  // free via newBattle()'s own incrementTurn() call right after construction, but we build Battle
  // directly here and skip newBattle() entirely. Without this, turnCommands stays undefined for the
  // whole battle, and CommandPhase.start()'s very first read of it
  // (`globalScene.currentBattle.turnCommands[this.fieldIndex]?.skip`) throws on `undefined[fieldIndex]`
  // right as the post-summon ability-trigger message (e.g. Pressure's) tries to auto-advance into the
  // move-selection UI — permanently freezing the battle on whatever message was last shown, since the
  // throw happens before ui.setMode(UiMode.COMMAND, ...) is ever reached.
  battle.incrementTurn();

  // Pokemon construction below (specifically EnemyPokemon#init() -> battle-info UI setup) reads
  // globalScene.currentBattle internally (e.g. to decide on final-boss name styling) — must be
  // assigned before building anyone, not after.
  globalScene.currentBattle = battle;

  // Build in a fixed order (host's picks, then guest's picks) on BOTH clients regardless of which
  // side is "mine" locally, so the two clients' RNG streams (and pokemon id assignment) advance in
  // the same order either way.
  const party = globalScene.getPlayerParty();
  const addedToParty: PlayerPokemon[] = [];
  try {
    for (const starter of hostStarters) {
      const pokemon = buildPvpPokemon(starter, isHost);
      if (isHost) {
        party.push(pokemon as PlayerPokemon);
        addedToParty.push(pokemon as PlayerPokemon);
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
        addedToParty.push(pokemon as PlayerPokemon);
      }
    }

    await Promise.all([...party, ...battle.enemyParty].map(p => p.loadAssets()));
  } catch (err) {
    // Anything thrown while building Pokemon or loading their assets used to leave the scene
    // half set up: currentBattle pointed at this broken PvP battle and the real player party
    // (shared with normal single-player play) carried whichever of these Pokemon had already
    // been pushed - with no run in progress to ever clean it up, that state persisted into
    // whatever the player did next (a normal run would start with unrelated Pokemon already
    // sitting in its party, missing arena setup this path never did, ...). Undo everything this
    // call added before reporting failure, so the scene is left exactly as clean as it was
    // before this function was ever called.
    for (const pokemon of addedToParty) {
      const idx = party.indexOf(pokemon);
      if (idx > -1) {
        party.splice(idx, 1);
      }
      pokemon.destroy();
    }
    for (const pokemon of battle.enemyParty) {
      pokemon.destroy();
    }
    trainer.destroy();
    globalScene.currentBattle = null!;
    console.error("Failed to build PvP battle:", err);
    return {
      ok: false,
      reason: `대전 준비 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  activeContext = { roomId: room.id, isHost };

  // Stays subscribed for the rest of the battle (unlike the turn/switch command channels, which
  // are each consumed once) - mirrors the opponent's form-change-item toggles onto this client's
  // view of their Pokemon as soon as they happen, whenever they happen (see
  // togglePvpFormChangeItem). No teardown yet since PvP battles have no end-of-battle cleanup
  // path at all yet - a known, pre-existing gap, not specific to this subscription.
  subscribePvpFormChangeState(room.id, !isHost, (pokemonId, active) => {
    const enemyPokemon = globalScene.getEnemyParty().find(p => p.id === pokemonId);
    if (enemyPokemon) {
      applyPvpFormChangeState(enemyPokemon, active);
    }
  });

  globalScene.phaseManager.pushNew("EncounterPhase", true);
  // pushNew() only queues the phase - it starts running once whatever phase is CURRENTLY active
  // calls its own end(), which normally happens on its own as part of natural gameplay. But we
  // got here from the PvP room panel, a plain DOM overlay sitting outside Phaser's phase system
  // entirely (see pvp-room-panel.ts's file header) while the title screen's own TitlePhase is
  // still sitting idle underneath, waiting on menu input that will never come from here. Without
  // this, EncounterPhase just sat queued forever and the title screen kept rendering exactly as
  // it was, even though startPvpBattle() itself had already "succeeded".
  // Phase.end()'s base implementation (see phase.ts) is exactly this call; only bypassing it here
  // because TitlePhase overrides end() to also start a brand new single-player run (set the game
  // mode, push SelectStarterPhase, call newArena(), ...), none of which should ever run for a PvP
  // battle - shiftPhase() advances the queue to our EncounterPhase without any of that.
  globalScene.phaseManager.shiftPhase();

  return { ok: true };
}
