/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Global leaderboard: one document per account in the `leaderboardStats` collection, holding
 * that account's best-known value for each tracked stat (Classic fastest clear time, Endless
 * max wave reached, PvP wins). Written opportunistically whenever a stat improves (see
 * battle-end-phase.ts, game-over-phase.ts, pvp-battle-end-phase.ts) and read as sorted top-N
 * lists by leaderboard-panel.ts.
 *
 * Like the rest of this project's cloud-save features, this has no real anti-cheat: a
 * sufficiently determined client could write a fabricated value directly. firestore.rules only
 * enforces that a value can move in the "improving" direction (lower for time, higher for
 * wave/wins) relative to what's already stored, which stops accidental regressions but not
 * outright fabrication - consistent with this project's existing threat model (see
 * firestore.rules' own comments on pvpRooms).
 */

import { getCloudSaveContext } from "#app/gift";
import { globalScene } from "#app/global-scene";
import {
  collection,
  doc,
  type Firestore,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

export type LeaderboardCategory = "classicBestTimeSeconds" | "endlessMaxWave" | "pvpWins";

interface LeaderboardStatsDoc {
  displayName: string;
  classicBestTimeSeconds?: number;
  endlessMaxWave?: number;
  pvpWins?: number;
}

export interface LeaderboardEntry {
  displayName: string;
  value: number;
}

function db(): Firestore {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    throw new Error("Not signed in with cloud save.");
  }
  return getFirestore(ctx.app);
}

/** A stable per-account display name — same resolution used elsewhere for PvP room names (see menu-ui-handler.ts's openPvpLobby). */
function myDisplayName(): string | null {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return null;
  }
  return ctx.user.displayName ?? ctx.user.email ?? ctx.user.uid;
}

/**
 * Writes the caller's new value for one leaderboard category, if signed in. Fire-and-forget by
 * design (callers are mid-battle-flow hooks that shouldn't block on network) - failures are
 * logged, not surfaced, mirroring pvp-room.ts's own submit* functions.
 */
export function submitLeaderboardStat(category: LeaderboardCategory, value: number): void {
  const ctx = getCloudSaveContext();
  const displayName = myDisplayName();
  if (!ctx || !displayName) {
    return;
  }
  setDoc(doc(db(), "leaderboardStats", ctx.user.uid), { displayName, [category]: value }, { merge: true }).catch(err =>
    console.error(`Failed to submit leaderboard stat ${category}:`, err),
  );
}

/**
 * Re-submits this account's currently-known best value for every leaderboard stat, from
 * gameStats (the local source of truth, always updated regardless of whether a past
 * submitLeaderboardStat() call actually reached Firestore). Fire-and-forget, called once each
 * time the title screen loads (see title-ui-handler.ts) - a safety net for stat improvements that
 * silently failed to upload earlier, e.g. a network hiccup, or - as happened once - a victory
 * landing before firestore.rules' leaderboardStats rules had actually been published.
 */
export function resubmitLeaderboardStats(): void {
  const stats = globalScene.gameData?.gameStats;
  if (!stats) {
    return;
  }
  if (stats.classicBestTimeSeconds > 0) {
    submitLeaderboardStat("classicBestTimeSeconds", stats.classicBestTimeSeconds);
  }
  if (stats.highestEndlessWave > 0) {
    submitLeaderboardStat("endlessMaxWave", stats.highestEndlessWave);
  }
  if (stats.pvpWins > 0) {
    submitLeaderboardStat("pvpWins", stats.pvpWins);
  }
}

/** One-shot fetch of the top `count` accounts for a category, best-first (ascending for time, descending for wave/wins). Returns an empty array on failure or if signed out. */
export async function fetchLeaderboardTop(category: LeaderboardCategory, count = 10): Promise<LeaderboardEntry[]> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return [];
  }
  try {
    const direction = category === "classicBestTimeSeconds" ? "asc" : "desc";
    const q = query(collection(db(), "leaderboardStats"), orderBy(category, direction), limit(count));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(d => d.data() as LeaderboardStatsDoc)
      .filter(d => typeof d[category] === "number")
      .map(d => ({ displayName: d.displayName, value: d[category] as number }));
  } catch (err) {
    console.error(`Failed to fetch leaderboard for ${category}:`, err);
    return [];
  }
}
