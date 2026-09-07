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
import { randomString } from "#utils/common";
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

/**
 * One side's chosen action for a given turn of an in-progress PvP battle (see pvp-battle.ts):
 * either using a move, or voluntarily switching out (via the Pokemon command). Forced
 * switch-on-faint is synced separately, see {@linkcode PvpSwitchCommand} below.
 */
export type PvpTurnCommand =
  | {
      command: "fight";
      /** Index (0-3) into the active Pokemon's moveset. */
      moveIndex: number;
    }
  | {
      command: "switch";
      /** The `id` (see {@linkcode PvpSwitchCommand}'s doc comment) of the Pokemon being switched in. */
      pokemonId: number;
      /** Whether this is a Baton Pass-style switch (stat stages/certain effects carry over). */
      isBaton: boolean;
    };

/**
 * One side's chosen replacement when one of their own Pokemon faints mid-battle (see
 * FaintPhase's non-player branch and PvpEnemySwitchPhase). Keyed by the fainted Pokemon's own
 * `id` rather than a party array index — see {@linkcode PvpRoom.hostSwitchCommands} — since
 * SwitchSummonPhase reorders both sides' party arrays on every switch, but each of the 6
 * Pokemon in a PvP battle gets a fixed, stable id (1-6, assigned in host-picks-then-guest-picks
 * order — see buildPvpPokemon/nextPvpPokemonId in pvp-battle.ts) that both clients agree on
 * without needing to exchange anything, since both build the same 6 Pokemon in the same order.
 */
export interface PvpSwitchCommand {
  command: "switch";
  /** The `id` (see above) of the Pokemon being sent in to replace the one that just fainted. */
  pokemonId: number;
}

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
  /** Shared RNG seed for the battle, set once by whichever side reaches "battling" first (see initiatePvpBattle). Both clients seed their local RNG with this so their independently-run battle simulations stay in lockstep. */
  pvpSeed?: string;
  /** This turn's command from each side, keyed by battle turn number. Written by the side that owns it, read by the other side's PvpEnemyCommandPhase. */
  hostTurnCommands?: Record<number, PvpTurnCommand>;
  guestTurnCommands?: Record<number, PvpTurnCommand>;
  /** Forced switch-in replacement from each side, keyed by the fainted Pokemon's own id (see {@linkcode PvpSwitchCommand}). Written by the side that owns it, read by the other side's PvpEnemySwitchPhase. */
  hostSwitchCommands?: Record<number, PvpSwitchCommand>;
  guestSwitchCommands?: Record<number, PvpSwitchCommand>;
  /**
   * Each side's Pokemon form-change held items (Mega Stone, Blue/Red Orb, ...) current
   * active/inactive state, keyed by that Pokemon's own stable id (see
   * {@linkcode PvpSwitchCommand}'s doc comment). A standalone, always-live broadcast (unlike the
   * turn/switch commands above, which are each consumed once) - PvP battles have no real Tera
   * access, so the command menu's Tera slot is repurposed to toggle this instead, and every
   * change is written here immediately so the opponent's client can mirror it as soon as it
   * happens, independent of turn boundaries (see togglePvpFormChangeItem in pvp-battle.ts).
   */
  hostFormChangeState?: Record<number, boolean>;
  guestFormChangeState?: Record<number, boolean>;
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

/**
 * Moves a room from "team_preview" (both picks in) to "battling" by writing a shared RNG seed.
 * Idempotent and safe to call from both accounts at once (see pvp-room-panel.ts): a transaction
 * guards against the two sides racing to pick different seeds, so whichever call commits first
 * wins and the other just observes the result. Does not itself construct any battle state — see
 * pvp-battle.ts's startPvpBattle() for that, called by each client once it sees "battling".
 */
export async function initiatePvpBattle(roomId: string): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    const roomRef = doc(db(), "pvpRooms", roomId);
    await runTransaction(db(), async transaction => {
      const snapshot = await transaction.get(roomRef);
      const room = snapshot.data() as PvpRoom | undefined;
      if (!room) {
        throw new Error("Room no longer exists.");
      }
      if (room.status === "battling" || room.pvpSeed) {
        // Already started by the other side (or a previous call of our own) — nothing to do.
        return;
      }
      if (room.status !== "team_preview" || !room.hostPicks || !room.guestPicks) {
        throw new Error("Room isn't ready to battle yet.");
      }
      transaction.update(roomRef, { status: "battling", pvpSeed: randomString(24) });
    });
    return true;
  } catch (err) {
    console.error("Failed to initiate PvP battle:", err);
    return false;
  }
}

/** Writes the caller's chosen action for the given battle turn, for the opposing client's PvpEnemyCommandPhase to pick up. */
export async function submitPvpTurnCommand(
  roomId: string,
  isHost: boolean,
  turn: number,
  command: PvpTurnCommand,
): Promise<void> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  try {
    const field = isHost ? "hostTurnCommands" : "guestTurnCommands";
    await updateDoc(doc(db(), "pvpRooms", roomId), { [`${field}.${turn}`]: command });
  } catch (err) {
    console.error("Failed to submit PvP turn command:", err);
  }
}

/**
 * Waits for the opposing side's command for the given turn to appear, then calls `onCommand`
 * once and automatically unsubscribes. `wantHostSide` says whose command to watch for (the
 * OPPONENT's side, from the caller's perspective — see PvpEnemyCommandPhase). Returns an
 * unsubscribe function in case the caller needs to cancel early (e.g. the phase never runs).
 */
export function subscribePvpTurnCommand(
  roomId: string,
  wantHostSide: boolean,
  turn: number,
  onCommand: (command: PvpTurnCommand) => void,
): () => void {
  const unsub = onSnapshot(
    doc(db(), "pvpRooms", roomId),
    snapshot => {
      const room = snapshot.data() as PvpRoom | undefined;
      const command = (wantHostSide ? room?.hostTurnCommands : room?.guestTurnCommands)?.[turn];
      if (command) {
        unsub();
        onCommand(command);
      }
    },
    err => console.error("PvP turn command subscription failed:", err),
  );
  return unsub;
}

/** Writes the caller's chosen replacement for their own fainted Pokemon, for the opposing client's PvpEnemySwitchPhase to pick up. */
export async function submitPvpSwitchCommand(
  roomId: string,
  isHost: boolean,
  faintedPokemonId: number,
  command: PvpSwitchCommand,
): Promise<void> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  try {
    const field = isHost ? "hostSwitchCommands" : "guestSwitchCommands";
    await updateDoc(doc(db(), "pvpRooms", roomId), { [`${field}.${faintedPokemonId}`]: command });
  } catch (err) {
    console.error("Failed to submit PvP switch command:", err);
  }
}

/**
 * Waits for the opposing side's replacement for the given fainted Pokemon id to appear, then
 * calls `onCommand` once and automatically unsubscribes. `wantHostSide` says whose command to
 * watch for (the OPPONENT's side, from the caller's perspective — see PvpEnemySwitchPhase).
 * Returns an unsubscribe function in case the caller needs to cancel early.
 */
export function subscribePvpSwitchCommand(
  roomId: string,
  wantHostSide: boolean,
  faintedPokemonId: number,
  onCommand: (command: PvpSwitchCommand) => void,
): () => void {
  const unsub = onSnapshot(
    doc(db(), "pvpRooms", roomId),
    snapshot => {
      const room = snapshot.data() as PvpRoom | undefined;
      const command = (wantHostSide ? room?.hostSwitchCommands : room?.guestSwitchCommands)?.[faintedPokemonId];
      if (command) {
        unsub();
        onCommand(command);
      }
    },
    err => console.error("PvP switch command subscription failed:", err),
  );
  return unsub;
}

/** Writes the caller's Pokemon's current form-change-item active state, for the opponent's client to mirror immediately (see PvpRoom.hostFormChangeState). */
export async function submitPvpFormChangeState(
  roomId: string,
  isHost: boolean,
  pokemonId: number,
  active: boolean,
): Promise<void> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  try {
    const field = isHost ? "hostFormChangeState" : "guestFormChangeState";
    await updateDoc(doc(db(), "pvpRooms", roomId), { [`${field}.${pokemonId}`]: active });
  } catch (err) {
    console.error("Failed to submit PvP form-change state:", err);
  }
}

/**
 * Subscribes for the rest of the battle (not a one-shot like the turn/switch command
 * subscriptions above) to the opposing side's form-change-item state, calling `onUpdate` with
 * each Pokemon id/active pair whenever the room document changes. `wantHostSide` says whose
 * state to watch (the OPPONENT's side, from the caller's perspective). The caller (see
 * pvp-battle.ts's startPvpBattle) is expected to no-op when the state already matches what's
 * locally applied, since this fires on every unrelated room update too, not just form-change
 * ones. Returns an unsubscribe function.
 */
export function subscribePvpFormChangeState(
  roomId: string,
  wantHostSide: boolean,
  onUpdate: (pokemonId: number, active: boolean) => void,
): () => void {
  return onSnapshot(
    doc(db(), "pvpRooms", roomId),
    snapshot => {
      const room = snapshot.data() as PvpRoom | undefined;
      const state = wantHostSide ? room?.hostFormChangeState : room?.guestFormChangeState;
      if (!state) {
        return;
      }
      for (const [pokemonIdStr, active] of Object.entries(state)) {
        onUpdate(Number(pokemonIdStr), active);
      }
    },
    err => console.error("PvP form-change state subscription failed:", err),
  );
}
