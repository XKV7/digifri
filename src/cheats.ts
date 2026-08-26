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
import { AbilityAttr } from "#enums/ability-attr";
import { DexAttr } from "#enums/dex-attr";
import { Nature } from "#enums/nature";
import { Passive as PassiveAttr } from "#enums/passive";
import { RibbonData } from "#system/ribbons/ribbon-data";

const ALL_DEX_ATTR =
  DexAttr.NON_SHINY |
  DexAttr.SHINY |
  DexAttr.MALE |
  DexAttr.FEMALE |
  DexAttr.DEFAULT_VARIANT |
  DexAttr.VARIANT_2 |
  DexAttr.VARIANT_3 |
  DexAttr.DEFAULT_FORM;

function allNatureAttr(): number {
  let attr = 0;
  for (const nature of Object.values(Nature)) {
    if (typeof nature === "number") {
      attr |= 1 << (nature + 1);
    }
  }
  return attr;
}

async function unlockAllPokemon(): Promise<void> {
  const gameData = globalScene?.gameData;
  if (!gameData) {
    alert("게임이 아직 로딩되지 않았습니다. 타이틀 화면이 뜬 뒤 다시 시도해주세요.");
    return;
  }

  const natureAttr = allNatureAttr();
  for (const species of speciesDataRegistry.getAllSpecies()) {
    const id = species.speciesId;
    let entry = gameData.dexData[id];
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
      gameData.dexData[id] = entry;
    }
    entry.seenAttr = ALL_DEX_ATTR;
    entry.caughtAttr = ALL_DEX_ATTR;
    entry.natureAttr = natureAttr;
    entry.seenCount = Math.max(entry.seenCount, 1);
    entry.caughtCount = Math.max(entry.caughtCount, 1);
    entry.ivs = [31, 31, 31, 31, 31, 31];
  }

  for (const id of speciesDataRegistry.getAllStarters()) {
    let starter = gameData.starterData[id];
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
      gameData.starterData[id] = starter;
    }
    starter.candyCount = Math.max(starter.candyCount, 999);
    starter.abilityAttr |= AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
    starter.passiveAttr |= PassiveAttr.UNLOCKED | PassiveAttr.ENABLED;
  }

  await gameData.saveSystem();
  alert("모든 포켓몬이 도감에 등록되고 스타터로 선택 가능해졌습니다. 새로고침합니다.");
  window.location.reload();
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

(window as unknown as { cheatUnlockAllPokemon: () => Promise<void> }).cheatUnlockAllPokemon = unlockAllPokemon;
(window as unknown as { cheatToggleEndlessCostLimit: () => void }).cheatToggleEndlessCostLimit =
  toggleEndlessCostLimit;
