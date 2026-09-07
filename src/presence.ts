/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Lightweight "who's currently online" presence, backed by one Firestore doc per signed-in
 * account (presence/{uid}) holding just a server-stamped `lastSeen` timestamp. Each client
 * refreshes its own doc on a heartbeat while the game is open; the online count shown on the
 * title screen (title-ui-handler.ts, replacing the real pokerogue.net-only "? players online"
 * stat this fork can't reach) is simply "how many presence docs have lastSeen within the last
 * PRESENCE_WINDOW_MS", counted server-side via a Firestore count() aggregation so the client never
 * has to download every doc.
 *
 * Like the rest of this project's cloud-save features, this only counts signed-in accounts and
 * has no anti-spoofing beyond "you can only write your own doc" - consistent with the project's
 * existing threat model (see firestore.rules).
 */

import { getCloudSaveContext } from "#app/gift";
import {
  collection,
  doc,
  getCountFromServer,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";

const HEARTBEAT_INTERVAL_MS = 30_000;
/** A client counts as online if its last heartbeat lands within this window - wide enough to tolerate a couple of missed/delayed heartbeats without flickering the count. */
const PRESENCE_WINDOW_MS = 90_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function writeHeartbeat(): void {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  setDoc(doc(getFirestore(ctx.app), "presence", ctx.user.uid), { lastSeen: serverTimestamp() }).catch(err =>
    console.error("Failed to write presence heartbeat:", err),
  );
}

/**
 * Starts sending a periodic presence heartbeat for the signed-in account. Called once, right
 * after cloud save sign-in completes (see cloud-save.ts's startSync()); safe to call more than
 * once, since a second call just no-ops against the already-running timer.
 */
export function startPresenceHeartbeat(): void {
  if (heartbeatTimer) {
    return;
  }
  writeHeartbeat();
  heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);
}

/** Counts signed-in accounts with a recent heartbeat. Returns null if signed out or on failure. */
export async function fetchOnlinePlayerCount(): Promise<number | null> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return null;
  }
  try {
    const db = getFirestore(ctx.app);
    const cutoff = Timestamp.fromMillis(Date.now() - PRESENCE_WINDOW_MS);
    const q = query(collection(db, "presence"), where("lastSeen", ">", cutoff));
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
  } catch (err) {
    console.error("Failed to fetch online player count:", err);
    return null;
  }
}
