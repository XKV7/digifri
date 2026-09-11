/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Optional debug/cheat helper exposed on `window` for manual use via the
 * browser console or a bookmarklet, e.g.:
 *   javascript:window.cheatUnlockAllPokemon()
 *
 * Only ever touches the current player's own local (and, if signed in,
 * cloud-synced) save data.
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { Egg } from "#data/egg";
import { AbilityAttr } from "#enums/ability-attr";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { Nature } from "#enums/nature";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { VariantTier } from "#enums/variant-tier";
import type { GameData } from "#system/game-data";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { VoucherType } from "#system/voucher";

const ALL_DEX_ATTR =
  DexAttr.NON_SHINY
  | DexAttr.SHINY
  | DexAttr.MALE
  | DexAttr.FEMALE
  | DexAttr.DEFAULT_VARIANT
  | DexAttr.VARIANT_2
  | DexAttr.VARIANT_3
  | DexAttr.DEFAULT_FORM;

export function allNatureAttr(): number {
  let attr = 0;
  for (const nature of Object.values(Nature)) {
    if (typeof nature === "number") {
      attr |= 1 << (nature + 1);
    }
  }
  return attr;
}

/** Marks a single species as seen/caught (all shiny/gender/variant combos, 31 IVs, all natures). */
export function unlockDexEntry(gameData: GameData, speciesId: SpeciesId, natureAttr: number): void {
  let entry = gameData.dexData[speciesId];
  if (!entry) {
    entry = {
      seenAttr: 0n,
      caughtAttr: 0n,
      natureAttr: 0,
      seenCount: 0,
      caughtCount: 0,
      hatchedCount: 0,
      ivs: [0, 0, 0, 0, 0, 0],
      ribbons: new RibbonData(0),
    };
    gameData.dexData[speciesId] = entry;
  }
  entry.seenAttr = ALL_DEX_ATTR;
  entry.caughtAttr = ALL_DEX_ATTR;
  entry.natureAttr = natureAttr;
  entry.seenCount = Math.max(entry.seenCount, 1);
  entry.caughtCount = Math.max(entry.caughtCount, 1);
  entry.ivs = [31, 31, 31, 31, 31, 31];
}

/** Candy-maxes a single starter species with every ability + passive unlocked. Only valid for starter species. */
export function unlockStarterEntry(gameData: GameData, speciesId: SpeciesId): void {
  let starter = gameData.starterData[speciesId];
  if (!starter) {
    starter = {
      moveset: null,
      eggMoves: 0,
      candyCount: 0,
      friendship: 0,
      abilityAttr: 0,
      passiveAttr: 0,
      valueReduction: 0,
      classicWinCount: 0,
    };
    gameData.starterData[speciesId] = starter;
  }
  starter.candyCount = Math.max(starter.candyCount, 999);
  starter.abilityAttr |= AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
  starter.passiveAttr |= PassiveAttr.UNLOCKED | PassiveAttr.ENABLED;
}

async function unlockAllPokemon(): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }

  const natureAttr = allNatureAttr();
  for (const species of speciesDataRegistry.getAllSpecies()) {
    unlockDexEntry(gameData, species.speciesId, natureAttr);
  }

  for (const id of speciesDataRegistry.getAllStarters()) {
    unlockStarterEntry(gameData, id);
  }

  await gameData.saveSystem();
  alert("모든 포켓몬이 도감에 등록되고 스타터로 선택 가능해졌습니다. 새로고침합니다.");
  window.location.reload();
}

/**
 * Reverses {@linkcode unlockDexEntry}/{@linkcode unlockStarterEntry} for a single species: clears its
 * caught status (so it no longer counts as owned/selectable as a starter) and resets its starter data
 * (candy, abilities, passives) back to the same zeroed shape {@linkcode GameData}#initStarterData gives
 * every starter at account creation. `seenAttr` is left untouched — having encountered the species in
 * the wild is dex knowledge, not ownership. Used by the Pokemon-gift flow (gift.ts) to make a gifted
 * species disappear from the sender's own account.
 *
 * @remarks
 * The starter data entry is reset in place, never deleted: GameData#validateSystemData requires every
 * non-default-starter species to have a starterData entry (even an all-zero one meaning "not owned"),
 * and treats a missing entry as save corruption — deleting it made saveSystem() fail validation and
 * silently discard the whole gift (species not actually removed, but reported as sent).
 */
export function revokeSpeciesEntry(gameData: GameData, speciesId: SpeciesId): void {
  const entry = gameData.dexData[speciesId];
  if (entry) {
    entry.caughtAttr = 0n;
    entry.caughtCount = 0;
    entry.ivs = [0, 0, 0, 0, 0, 0];
  }
  gameData.starterData[speciesId] = {
    moveset: null,
    eggMoves: 0,
    candyCount: 0,
    friendship: 0,
    abilityAttr: 0,
    passiveAttr: 0,
    valueReduction: 0,
    classicWinCount: 0,
  };
}

/**
 * Toggles the Endless/Spliced Endless starter select cost limit between the
 * normal value (15) and effectively unlimited (999). Purely a per-device
 * localStorage flag (see starter-select-ui-handler.ts#getValueLimit) — does
 * not touch save data or the cloud, so it must be toggled again on any other
 * device/browser you want it enabled on.
 */
function toggleEndlessCostLimit(): void {
  const key = "cheatNoEndlessCostLimit";
  const enabling = localStorage.getItem(key) !== "1";
  if (enabling) {
    localStorage.setItem(key, "1");
  } else {
    localStorage.removeItem(key);
  }
  alert(
    enabling
      ? "엔드리스 모드 코스트 제한이 해제되었습니다 (999). 스타터 선택 화면에서 확인하세요."
      : "엔드리스 모드 코스트 제한이 원래대로(15) 복원되었습니다.",
  );
}

/** Adds `amount` EX (Master) vouchers to the current save. */
async function addExVouchers(amount: number): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }

  gameData.voucherCounts[VoucherType.MASTER] += amount;
  await gameData.saveSystem();
  alert(`EX 바우처 ${amount}개가 지급되었습니다. 새로고침합니다.`);
  window.location.reload();
}

/** Marks MissingNo. as caught (all variants, 31 IVs, all natures) and candy-maxed as a starter. */
async function giveMissingNo(): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }

  unlockDexEntry(gameData, SpeciesId.MISSING_NO, allNatureAttr());
  unlockStarterEntry(gameData, SpeciesId.MISSING_NO);

  await gameData.saveSystem();
  alert("MissingNo.가 도감에 등록되고 스타터로 선택 가능해졌습니다. 새로고침합니다.");
  window.location.reload();
}

/**
 * Adds a real egg guaranteed to hatch into MissingNo. to the current save (so it can be hatched
 * and shows up in the egg box like any other egg), and also immediately marks it caught/candy-
 * maxed as a starter - same "fully unlocked" state {@linkcode giveMissingNo} grants directly.
 */
async function giveMissingNoEgg(): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }

  const egg = new Egg({ species: SpeciesId.MISSING_NO, sourceType: EggSourceType.EVENT });
  egg.addEggToGameData();

  unlockDexEntry(gameData, SpeciesId.MISSING_NO, allNatureAttr());
  unlockStarterEntry(gameData, SpeciesId.MISSING_NO);

  await gameData.saveSystem();
  alert("MissingNo. 알을 지급했고, 도감/스타터도 전부 해금 상태로 등록했습니다. 새로고침합니다.");
  window.location.reload();
}

/**
 * Adds a real egg guaranteed to hatch into a variant-2 ("3-luck"/rainbow) shiny Zacian to the
 * current save - same `species` egg-option override {@linkcode giveMissingNoEgg} uses to bypass
 * the normal egg-tier species pool, plus `isShiny`/`variantTier` to force the specific shiny tier
 * instead of leaving it to the normal shiny/variant roll.
 */
async function giveShinyZacianEgg(): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }

  const egg = new Egg({
    species: SpeciesId.ZACIAN,
    sourceType: EggSourceType.EVENT,
    isShiny: true,
    variantTier: VariantTier.EPIC,
  });
  // Egg's own constructor silently forces variantTier back to STANDARD whenever
  // speciesDataRegistry.getSpecies(...).hasVariants() reads false at that exact moment - which it
  // can spuriously do very early after boot, before BattleScene#initVariantData()'s masterlist
  // fetch has resolved (a known race condition, acknowledged in that method's own TODO comment;
  // confirmed flaky in local testing - sometimes over a minute after boot). Rather than race that
  // timing, force the intended values back in directly after construction: isShiny/variantTier
  // are only ever read afterward (serialization, hatch dialogue), never re-derived, so this is
  // safe and fully deterministic regardless of load timing.
  Object.assign(egg, { _isShiny: true, _variantTier: VariantTier.EPIC });
  egg.addEggToGameData();

  await gameData.saveSystem();
  alert("이로치(3연성) 자시안 알을 지급했습니다. 알 목록에서 부화시키면 얻을 수 있어요. 새로고침합니다.");
  window.location.reload();
}

/**
 * Adds two real eggs to the current save - one guaranteed to hatch into Pikachu, one guaranteed to
 * hatch into Manaphy - using the same `species` egg-option override {@linkcode giveMissingNoEgg}
 * uses to bypass the normal egg-tier species pool (and, for Manaphy specifically, its own
 * Manaphy-vs-Phione roll in Egg#rollSpecies).
 */
async function givePikachuAndManaphyEggs(): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }

  new Egg({ species: SpeciesId.PIKACHU, sourceType: EggSourceType.EVENT }).addEggToGameData();
  new Egg({ species: SpeciesId.MANAPHY, sourceType: EggSourceType.EVENT }).addEggToGameData();

  await gameData.saveSystem();
  alert("피카츄 알과 마나피 알을 지급했습니다. 알 목록에서 부화시키면 얻을 수 있어요. 새로고침합니다.");
  window.location.reload();
}

(window as unknown as { cheatUnlockAllPokemon: () => Promise<void> }).cheatUnlockAllPokemon = unlockAllPokemon;
(window as unknown as { cheatToggleEndlessCostLimit: () => void }).cheatToggleEndlessCostLimit = toggleEndlessCostLimit;
(window as unknown as { cheatAddExVouchers: (amount: number) => Promise<void> }).cheatAddExVouchers = addExVouchers;
(window as unknown as { cheatGiveMissingNo: () => Promise<void> }).cheatGiveMissingNo = giveMissingNo;
(window as unknown as { cheatGiveMissingNoEgg: () => Promise<void> }).cheatGiveMissingNoEgg = giveMissingNoEgg;
(window as unknown as { cheatGiveShinyZacianEgg: () => Promise<void> }).cheatGiveShinyZacianEgg = giveShinyZacianEgg;
(window as unknown as { cheatGivePikachuAndManaphyEggs: () => Promise<void> }).cheatGivePikachuAndManaphyEggs =
  givePikachuAndManaphyEggs;
