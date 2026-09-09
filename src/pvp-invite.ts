/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Direct PvP invites: send a battle invite to a specific account from the title screen's player
 * list (see friend-list-panel.ts), rather than posting an open room to the public lobby.
 *
 * Sending an invite creates an invite-only PvP room (pvp-room.ts's createPvpRoom with
 * invitedUid set, so only the target can join it) and drops a pointer to that room into
 * `pvpInvites/{targetUid}/inbox/{autoId}`. The recipient's client checks its own inbox
 * opportunistically (title screen load, player list panel open) and, on accept, joins that room
 * via the existing joinPvpRoom()/openPvpRoomPanel() flow - identical to joining any other PvP
 * room from here on. See firestore.rules for the security rules this relies on - they must be
 * published in the Firebase console for this to work.
 */

import { getCloudSaveContext } from "#app/gift";
import { myDisplayName } from "#app/leaderboard";
import { createPvpRoom, joinPvpRoom } from "#app/pvp-room";
import { openPvpRoomPanel } from "#app/pvp-room-panel";
import { addDoc, collection, deleteDoc, doc, type Firestore, getDocs, getFirestore } from "firebase/firestore";

interface StoredPvpInvite {
  fromUid: string;
  fromName: string;
  roomId: string;
  createdAt: number;
}

export interface PvpInvite extends StoredPvpInvite {
  id: string;
}

function db(): Firestore {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    throw new Error("Not signed in with cloud save.");
  }
  return getFirestore(ctx.app);
}

/** Creates an invite-only room and drops an invite into the target's inbox. Returns whether it succeeded. */
export async function sendPvpInvite(targetUid: string, myName: string): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  const roomId = await createPvpRoom(myName, targetUid);
  if (!roomId) {
    return false;
  }
  try {
    await addDoc(collection(db(), "pvpInvites", targetUid, "inbox"), {
      fromUid: ctx.user.uid,
      fromName: myName,
      roomId,
      createdAt: Date.now(),
    } satisfies StoredPvpInvite);
    return true;
  } catch (err) {
    console.error("Failed to send PvP invite:", err);
    return false;
  }
}

/** One-shot fetch of the caller's own pending invites. Returns an empty array on failure or if signed out. */
export async function checkPendingPvpInvites(): Promise<PvpInvite[]> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return [];
  }
  try {
    const snapshot = await getDocs(collection(db(), "pvpInvites", ctx.user.uid, "inbox"));
    return snapshot.docs.map(d => ({ id: d.id, ...(d.data() as StoredPvpInvite) }));
  } catch (err) {
    console.error("Failed to check PvP invites:", err);
    return [];
  }
}

/** Removes one pending invite from the caller's own inbox (declined, expired, or already handled). */
export async function deletePvpInvite(inviteId: string): Promise<void> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return;
  }
  try {
    await deleteDoc(doc(db(), "pvpInvites", ctx.user.uid, "inbox", inviteId));
  } catch (err) {
    console.error("Failed to remove PvP invite:", err);
  }
}

/** Accepts an invite: joins its room as guest, then deletes the invite either way (it's been acted on). Returns whether the join succeeded. */
export async function acceptPvpInvite(invite: PvpInvite, myName: string): Promise<boolean> {
  const ok = await joinPvpRoom(invite.roomId, myName);
  await deletePvpInvite(invite.id);
  return ok;
}

/** A small accept/decline confirm overlay, same plain-DOM style as cloud-save.ts's login overlay. */
function showInviteOverlay(invite: PvpInvite): Promise<"accept" | "decline"> {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;"
      + "align-items:center;justify-content:center;gap:16px;font-family:sans-serif;color:#fff;text-align:center;padding:16px;";
    const title = document.createElement("div");
    title.style.cssText = "font-size:20px;font-weight:bold;";
    title.textContent = "PvP 대전 초대";
    const desc = document.createElement("div");
    desc.style.cssText = "font-size:14px;opacity:0.85;max-width:420px;line-height:1.5;";
    desc.textContent = `${invite.fromName}님이 PvP 대전을 신청했습니다.`;
    const btnStyle =
      "font-size:16px;padding:12px 24px;border-radius:8px;border:none;cursor:pointer;min-width:200px;font-weight:bold;";
    const acceptBtn = document.createElement("button");
    acceptBtn.style.cssText = btnStyle + "background:#3d5a80;color:#fff;";
    acceptBtn.textContent = "수락";
    const declineBtn = document.createElement("button");
    declineBtn.style.cssText = btnStyle + "background:#555;color:#fff;";
    declineBtn.textContent = "거절";
    const done = (choice: "accept" | "decline") => {
      overlay.remove();
      resolve(choice);
    };
    acceptBtn.onclick = () => done("accept");
    declineBtn.onclick = () => done("decline");
    overlay.append(title, desc, acceptBtn, declineBtn);
    document.body.appendChild(overlay);
  });
}

/**
 * Checks for a pending PvP invite and, if there is one, prompts accept/decline. Handles at most
 * one invite per call (simple, opportunistic - see checkPendingPvpInvites()'s doc comment); any
 * additional pending invites are picked up on the next check. Call this from the title screen
 * (see title-ui-handler.ts) and when the player list panel opens.
 */
export async function promptPendingPvpInvite(): Promise<void> {
  const myName = myDisplayName();
  if (!myName) {
    return;
  }
  const invites = await checkPendingPvpInvites();
  const invite = invites[0];
  if (!invite) {
    return;
  }
  const choice = await showInviteOverlay(invite);
  if (choice === "decline") {
    await deletePvpInvite(invite.id);
    return;
  }
  const ok = await acceptPvpInvite(invite, myName);
  if (ok) {
    openPvpRoomPanel(invite.roomId, false);
  }
}
