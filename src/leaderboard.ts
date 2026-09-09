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
  /** The calendar month (see getMonthKey()) `classicBestTimeSeconds` was set in - a run started in an earlier month than the current one no longer counts, so the leaderboard effectively resets each month. */
  classicMonthKey?: string;
  endlessMaxWave?: number;
  pvpWins?: number;
}

/** The current calendar month as a stable, lexicographically-sortable key, e.g. `"2026-09"`. */
export function getMonthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
export function myDisplayName(): string | null {
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
 * Writes the caller's Classic clear time toward the *current month's* leaderboard entry, if the
 * run that produced it was started this month - a run that started in an earlier month doesn't
 * count toward any month's record, per the monthly-reset design (see getMonthKey()). Unlike
 * submitLeaderboardStat(), this is NOT gated on beating the account's all-time local best
 * (game-over-phase.ts tracks that separately) - a slower-than-ever-before clear can still be this
 * account's first (and so best) clear of the current month. firestore.rules is the actual
 * arbiter of whether this value "wins" within the month; a rejected write here is the normal,
 * expected outcome when it doesn't improve on what's already stored for this month.
 */
export function submitClassicMonthlyRecord(clearTimeSeconds: number, runStartTimestamp: number | null): void {
  if (runStartTimestamp == null || getMonthKey(new Date(runStartTimestamp)) !== getMonthKey()) {
    return;
  }
  const ctx = getCloudSaveContext();
  const displayName = myDisplayName();
  if (!ctx || !displayName) {
    return;
  }
  setDoc(
    doc(db(), "leaderboardStats", ctx.user.uid),
    { displayName, classicBestTimeSeconds: clearTimeSeconds, classicMonthKey: getMonthKey() },
    { merge: true },
  ).catch(err => console.error("Failed to submit monthly Classic leaderboard record:", err));
}

/**
 * Re-submits this account's currently-known best value for every leaderboard stat except Classic
 * clear time, from gameStats (the local source of truth, always updated regardless of whether a
 * past submitLeaderboardStat() call actually reached Firestore). Fire-and-forget, called once
 * each time the title screen loads (see title-ui-handler.ts) - a safety net for stat improvements
 * that silently failed to upload earlier, e.g. a network hiccup, or - as happened once - a
 * victory landing before firestore.rules' leaderboardStats rules had actually been published.
 *
 * Classic clear time is deliberately excluded: gameStats.classicBestTimeSeconds is an all-time
 * local best with no month attached to it, so blindly resubmitting it here (independent of when
 * that run was actually started) could misattribute an old record to the current month. Only
 * game-over-phase.ts submits it, via submitClassicMonthlyRecord() with the real run-start time.
 */
export function resubmitLeaderboardStats(): void {
  const stats = globalScene.gameData?.gameStats;
  if (!stats) {
    return;
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

/**
 * One-shot fetch of the top `count` accounts for THIS MONTH's Classic clear-time leaderboard,
 * fastest-first. Fetches a larger batch ordered by classicBestTimeSeconds (same index as
 * fetchLeaderboardTop, no new Firestore setup needed) and filters to the current month
 * client-side, rather than adding a `where("classicMonthKey", ...)` clause - combining that with
 * the existing `orderBy` would need a composite index created manually in the Firebase console,
 * which nothing here prompts for or checks (see listOpenPvpRoomsOnce() in pvp-room.ts for the
 * same reasoning). Fine at this project's scale.
 */
export async function fetchClassicMonthlyLeaderboard(count = 10): Promise<LeaderboardEntry[]> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return [];
  }
  try {
    const monthKey = getMonthKey();
    const q = query(collection(db(), "leaderboardStats"), orderBy("classicBestTimeSeconds", "asc"), limit(100));
    const snapshot = await getDocs(q);
    return snapshot.docs
      .map(d => d.data() as LeaderboardStatsDoc)
      .filter(d => typeof d.classicBestTimeSeconds === "number" && d.classicMonthKey === monthKey)
      .slice(0, count)
      .map(d => ({ displayName: d.displayName, value: d.classicBestTimeSeconds as number }));
  } catch (err) {
    console.error("Failed to fetch monthly Classic leaderboard:", err);
    return [];
  }
}
