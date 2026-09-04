/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PvP lobby: create/list/join battle rooms. A room starts "waiting" (open,
 * listed in the lobby, named after its host) until a second account joins,
 * at which point it moves to "team_preview" (both accounts see each other's
 * registered 6-Pokemon roster — see pvp-team.ts — and each picks 3 to bring
 * into the actual battle). See firestore.rules for the security rules this
 * relies on — they must be published in the Firebase console for this to work.
 */

import { getCloudSaveContext } from "#app/gift";
import {
  collection,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

export type PvpRoomStatus = "waiting" | "team_preview" | "battling" | "finished" | "cancelled";

export interface PvpRoom {
  hostUid: string;
  hostName: string;
  status: PvpRoomStatus;
  createdAt: Timestamp;
  guestUid?: string;
  guestName?: string;
  /** Indices (0-5) into the host's/guest's registered PvP team, chosen during team preview. */
  hostPicks?: number[];
  guestPicks?: number[];
}

export interface PvpRoomWithId extends PvpRoom {
  id: string;
}

function db(): Firestore {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    throw new Error("Not signed in with cloud save.");
  }
  return getFirestore(ctx.app);
}

/** Creates a new open room named after the host, and returns its id (or null on failure). */
export async function createPvpRoom(hostName: string): Promise<string | null> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return null;
  }
  try {
    // A brand-new document, so a plain write is enough — no read-modify-write race to guard
    // against a transaction would be for (unlike join/cancel below, which do have one).
    const roomRef = doc(collection(db(), "pvpRooms"));
    await setDoc(roomRef, {
      hostUid: ctx.user.uid,
      hostName,
      status: "waiting",
      createdAt: serverTimestamp(),
    });
    setMyActivePvpRoomId(roomRef.id);
    return roomRef.id;
  } catch (err) {
    console.error("Failed to create PvP room:", err);
    return null;
  }
}

/** Newest-first, guarding against createdAt still being an unresolved server-timestamp sentinel (null) locally. */
function byCreatedAtDesc(a: PvpRoom, b: PvpRoom): number {
  return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
}

/** One-shot fetch of the currently open ("waiting") rooms, newest first. */
export async function listOpenPvpRoomsOnce(): Promise<PvpRoomWithId[]> {
  try {
    // Sorted client-side rather than via a second `orderBy("createdAt")` clause — combining
    // that with the `where("status", ...)` filter above would need a composite index created
    // manually in the Firebase console, which nothing here prompts for or checks; skipping it
    // avoids that trap entirely.
    const q = query(collection(db(), "pvpRooms"), where("status", "==", "waiting"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...(d.data() as PvpRoom) })).sort(byCreatedAtDesc);
  } catch (err) {
    console.error("Failed to list PvP rooms:", err);
    return [];
  }
}

/** One-shot fetch of a single room's current state, or null if it doesn't exist. */
export async function getPvpRoomOnce(roomId: string): Promise<PvpRoomWithId | null> {
  try {
    const snapshot = await getDoc(doc(db(), "pvpRooms", roomId));
    return snapshot.exists() ? { id: snapshot.id, ...(snapshot.data() as PvpRoom) } : null;
  } catch (err) {
    console.error("Failed to fetch PvP room:", err);
    return null;
  }
}

const activeRoomStorageKey = "pvpActiveRoomId";

/** The room id the caller most recently created or joined (persisted locally), if any. */
export function getMyActivePvpRoomId(): string | null {
  return localStorage.getItem(activeRoomStorageKey);
}

export function setMyActivePvpRoomId(roomId: string | null): void {
  if (roomId) {
    localStorage.setItem(activeRoomStorageKey, roomId);
  } else {
    localStorage.removeItem(activeRoomStorageKey);
  }
}

/**
 * Subscribes to the live list of open ("waiting") rooms, newest first, calling `onUpdate`
 * with the current list every time it changes. Returns an unsubscribe function.
 */
export function subscribeOpenPvpRooms(onUpdate: (rooms: PvpRoomWithId[]) => void): () => void {
  const q = query(collection(db(), "pvpRooms"), where("status", "==", "waiting"));
  return onSnapshot(
    q,
    snapshot => {
      onUpdate(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as PvpRoom) })).sort(byCreatedAtDesc));
    },
    err => console.error("PvP room list subscription failed:", err),
  );
}

/**
 * Subscribes to a single room's live document, calling `onUpdate` with its current state
 * (or null if it no longer exists) every time it changes. Returns an unsubscribe function.
 */
export function subscribePvpRoom(roomId: string, onUpdate: (room: PvpRoomWithId | null) => void): () => void {
  return onSnapshot(
    doc(db(), "pvpRooms", roomId),
    snapshot => {
      onUpdate(snapshot.exists() ? { id: snapshot.id, ...(snapshot.data() as PvpRoom) } : null);
    },
    err => console.error("PvP room subscription failed:", err),
  );
}

/**
 * Joins an open room as its guest. Uses a transaction so two accounts racing to join the
 * same room can't both succeed — whichever transaction commits first wins, the other's
 * precondition (`status === "waiting"`) fails and it returns false.
 */
export async function joinPvpRoom(roomId: string, guestName: string): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    const roomRef = doc(db(), "pvpRooms", roomId);
    await runTransaction(db(), async transaction => {
      const snapshot = await transaction.get(roomRef);
      const room = snapshot.data() as PvpRoom | undefined;
      if (!room || room.status !== "waiting") {
        throw new Error("Room is no longer open.");
      }
      if (room.hostUid === ctx.user.uid) {
        throw new Error("Can't join your own room.");
      }
      transaction.update(roomRef, {
        guestUid: ctx.user.uid,
        guestName,
        status: "team_preview",
      });
    });
    setMyActivePvpRoomId(roomId);
    return true;
  } catch (err) {
    console.error("Failed to join PvP room:", err);
    return false;
  }
}

/** Cancels a room the caller is hosting (only valid while still "waiting"). */
export async function cancelPvpRoom(roomId: string): Promise<void> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  try {
    const roomRef = doc(db(), "pvpRooms", roomId);
    await runTransaction(db(), async transaction => {
      const snapshot = await transaction.get(roomRef);
      const room = snapshot.data() as PvpRoom | undefined;
      if (!room || room.hostUid !== ctx.user.uid) {
        return;
      }
      transaction.update(roomRef, { status: "cancelled" });
    });
  } catch (err) {
    console.error("Failed to cancel PvP room:", err);
  } finally {
    if (getMyActivePvpRoomId() === roomId) {
      setMyActivePvpRoomId(null);
    }
  }
}

/**
 * Submits the caller's chosen 3-of-6 team-preview picks (indices into their own registered
 * PvP team — see pvp-team.ts). `isHost` says which side's field to write, since the caller
 * already knows this from the room doc they're looking at.
 */
export async function submitPvpTeamPreviewPicks(roomId: string, isHost: boolean, picks: number[]): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    await updateDoc(doc(db(), "pvpRooms", roomId), isHost ? { hostPicks: picks } : { guestPicks: picks });
    return true;
  } catch (err) {
    console.error("Failed to submit PvP team preview picks:", err);
    return false;
  }
}

/**
 * Marks a room "finished" once both sides' team-preview picks are in. Either participant may
 * call this (both do, independently, on seeing both picks arrive — see pvp-room-panel.ts) —
 * idempotent, so a race between them is harmless. Also clears the caller's own local
 * active-room pointer.
 */
export async function finishPvpTeamPreview(roomId: string): Promise<void> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  try {
    await updateDoc(doc(db(), "pvpRooms", roomId), { status: "finished" });
  } catch (err) {
    console.error("Failed to finish PvP team preview:", err);
  } finally {
    if (getMyActivePvpRoomId() === roomId) {
      setMyActivePvpRoomId(null);
    }
  }
}
