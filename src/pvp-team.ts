/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PvP team registration. Each cloud-signed-in account can register up to
 * PLAYER_PARTY_MAX_SIZE Pokemon (the same `Starter` shape/configuration the
 * normal pre-run starter select screen produces — species, ability, nature,
 * IVs, moveset, etc.) as their standing PvP roster, stored at
 * `pvpTeams/{uid}`. Any signed-in account may read another account's team
 * (needed to build the opponent's side of a PvP battle); only the owner may
 * write their own. See firestore.rules.
 */

import { getCloudSaveContext } from "#app/gift";
import { globalScene } from "#app/global-scene";
import type { Starter } from "#types/save-data";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

export async function savePvpTeam(starters: Starter[]): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    const db = getFirestore(ctx.app);
    // Starter has several optional fields (female, moveset, nickname, teraType, ...) that the
    // starter-select screen can leave as an explicit `undefined` rather than just omitting the
    // key — the Firestore SDK rejects any value containing `undefined` outright. Round-tripping
    // through JSON drops those keys entirely (JSON.stringify skips undefined properties), giving
    // a payload Firestore will actually accept.
    const sanitizedStarters = JSON.parse(JSON.stringify(starters));
    await setDoc(doc(db, "pvpTeams", ctx.user.uid), { starters: sanitizedStarters, updatedAt: Date.now() });
    return true;
  } catch (err) {
    console.error("Failed to save PvP team:", err);
    return false;
  }
}

/** Loads the caller's own PvP team by default, or another account's by uid (for battle setup). */
export async function loadPvpTeam(uid?: string): Promise<Starter[] | null> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return null;
  }
  try {
    const db = getFirestore(ctx.app);
    const snapshot = await getDoc(doc(db, "pvpTeams", uid ?? ctx.user.uid));
    if (!snapshot.exists()) {
      return null;
    }
    const data = snapshot.data();
    return Array.isArray(data.starters) ? (data.starters as Starter[]) : null;
  } catch (err) {
    console.error("Failed to load PvP team:", err);
    return null;
  }
}

/**
 * While true, StarterSelectUiHandler relaxes the normal per-run starter-cost
 * value limit and skips the run-affecting side effects (starting money reset,
 * title-screen/phase-queue changes on exit) that only make sense when the
 * screen is opened via SelectStarterPhase to actually start a run. Set by
 * beginPvpTeamEditMode()/endPvpTeamEditMode() below.
 */
let pvpTeamEditModeActive = false;

export function isPvpTeamEditMode(): boolean {
  return pvpTeamEditModeActive;
}

/**
 * The screen reused for PvP team registration (StarterSelectUiHandler) is
 * normally only ever entered via a full `ui.setMode()` that clears whatever
 * was showing before it (SelectStarterPhase, always from a freshly-cleared
 * title screen). Opening it here instead as a non-clearing `setOverlayMode()`
 * overlay (so we can cleanly `ui.revertMode()` back to wherever the menu was
 * opened from, title or mid-run) can leave the previous screen's own visuals
 * rendered underneath, occasionally visible through gaps in the starter
 * select screen's own background/instruction box.
 *
 * Explicitly hiding/restoring the underlying handler (`.clear()` on entry,
 * `.show([])` on exit) was tried here and reverted: `UiHandler#show(args)`
 * contracts vary wildly — several handlers (e.g. any OptionSelectUiHandler
 * subclass, including the title screen) require specific args and simply
 * no-op — skipping ALL their own setup, leaving nothing visible at all —
 * when called with none. That left the screen completely blank and
 * unresponsive after finishing, which is far worse than the cosmetic
 * bleed-through it was meant to fix, so it's been backed out; the rare
 * visual overlap is an accepted tradeoff for now.
 */
export function beginPvpTeamEditMode(): void {
  pvpTeamEditModeActive = true;
  // Hides the per-slot cycle buttons (form/gender/shiny/ability/nature/tera) on
  // the mobile touch pad — see the [data-pvp-edit] rule in index.css — since
  // they're not needed just to pick species and only add to an already-crowded
  // corner of the screen.
  document.getElementById("touchControls")?.setAttribute("data-pvp-edit", "1");
  // If a touch was mid-press when this screen transition happened, its
  // touchend/pointerup can be missed, leaving that direction/button "stuck"
  // held down (TouchControl#buttonLock) and unresponsive afterward — same
  // failure mode the game already guards against on window blur.
  globalScene.inputController?.loseFocus();
}

export function endPvpTeamEditMode(): void {
  pvpTeamEditModeActive = false;
  document.getElementById("touchControls")?.removeAttribute("data-pvp-edit");
  globalScene.inputController?.loseFocus();
}
