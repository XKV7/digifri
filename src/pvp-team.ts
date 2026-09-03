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
import type { Starter } from "#types/save-data";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

export async function savePvpTeam(starters: Starter[]): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    const db = getFirestore(ctx.app);
    await setDoc(doc(db, "pvpTeams", ctx.user.uid), { starters, updatedAt: Date.now() });
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
 * screen is opened via SelectStarterPhase to actually start a run. Set around
 * opening the screen for PvP team registration (which can happen mid-run,
 * from the ESC menu) and cleared once that flow ends.
 */
let pvpTeamEditModeActive = false;

export function setPvpTeamEditMode(active: boolean): void {
  pvpTeamEditModeActive = active;
}

export function isPvpTeamEditMode(): boolean {
  return pvpTeamEditModeActive;
}
