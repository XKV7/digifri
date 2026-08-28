/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * In-game gifting between two cloud-synced (Google sign-in) accounts.
 *
 * A sender addresses a gift to a recipient's Google account email. This is
 * resolved to a Firebase UID via `giftProfiles/{uid}` (a tiny public
 * email->uid lookup each signed-in client publishes for itself), then the
 * gift is dropped into `gifts/{targetUid}/inbox/{autoId}`. The recipient's
 * client claims (applies + deletes) any pending gifts the next time they
 * open the in-game menu. See firestore.rules for the security rules this
 * relies on — they must be published in the Firebase console for this to work.
 */

import { allNatureAttr, revokeSpeciesEntry, unlockDexEntry, unlockStarterEntry } from "#app/cheats";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { SpeciesId } from "#enums/species-id";
import { VoucherType } from "#system/voucher";
import type { FirebaseApp } from "firebase/app";
import type { User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  where,
} from "firebase/firestore";

export type GiftPayload = { kind: "voucher"; voucherType: VoucherType } | { kind: "pokemon"; speciesId: SpeciesId };

interface CloudSaveContext {
  app: FirebaseApp;
  user: User;
}

let cloudSaveContext: CloudSaveContext | undefined;

/** Called by cloud-save.ts once sign-in completes. */
export function setCloudSaveContext(app: FirebaseApp, user: User): void {
  cloudSaveContext = { app, user };
}

export function getCloudSaveContext(): CloudSaveContext | undefined {
  return cloudSaveContext;
}

/** Publishes this account's email -> uid mapping so others can address gifts to it by email. */
export async function publishGiftProfile(app: FirebaseApp, user: User): Promise<void> {
  if (!user.email) {
    return;
  }
  try {
    const db = getFirestore(app);
    await setDoc(doc(db, "giftProfiles", user.uid), { email: user.email.toLowerCase() });
  } catch (err) {
    console.error("Failed to publish gift profile:", err);
  }
}

export async function sendGift(
  app: FirebaseApp,
  fromUser: User,
  targetEmail: string,
  payload: GiftPayload,
): Promise<{ ok: boolean; message: string }> {
  const email = targetEmail.trim().toLowerCase();
  if (!email) {
    return { ok: false, message: "이메일을 입력해주세요." };
  }

  const db = getFirestore(app);
  let targetUid: string;
  try {
    const snapshot = await getDocs(query(collection(db, "giftProfiles"), where("email", "==", email), limit(1)));
    if (snapshot.empty) {
      return { ok: false, message: "해당 이메일로 클라우드 저장을 사용 중인 계정을 찾을 수 없습니다." };
    }
    targetUid = snapshot.docs[0].id;
  } catch (err) {
    console.error("Gift recipient lookup failed:", err);
    return { ok: false, message: "선물 대상을 찾는 중 오류가 발생했습니다." };
  }

  if (targetUid === fromUser.uid) {
    return { ok: false, message: "자기 자신에게는 선물을 보낼 수 없습니다." };
  }

  // Pokemon gifts transfer ownership: the sender must currently own the species, and it's
  // revoked from their own account below once the gift is confirmed sent (never before —
  // if the send fails, the sender keeps it).
  const gameData = globalScene?.gameData;
  if (payload.kind === "pokemon") {
    if (!gameData) {
      return { ok: false, message: "게임이 아직 로딩되지 않았습니다." };
    }
    if (!gameData.dexData[payload.speciesId]?.caughtAttr) {
      return { ok: false, message: "이 포켓몬을 보유하고 있지 않아 선물할 수 없습니다." };
    }
  }

  try {
    await addDoc(collection(db, "gifts", targetUid, "inbox"), {
      ...payload,
      fromEmail: fromUser.email ?? "",
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("Sending gift failed:", err);
    return { ok: false, message: "선물을 보내는 중 오류가 발생했습니다." };
  }

  if (payload.kind === "pokemon" && gameData) {
    revokeSpeciesEntry(gameData, payload.speciesId);
    await gameData.saveSystem();
    return {
      ok: true,
      message: "선물을 보냈습니다! 이 포켓몬은 더 이상 내 계정에서 사용할 수 없습니다.",
    };
  }

  return { ok: true, message: "선물을 보냈습니다! 상대가 다음에 메뉴를 열 때 받게 됩니다." };
}

/** Applies any pending gifts to the current save and removes them from the inbox. Safe to call repeatedly. */
export async function claimGifts(): Promise<void> {
  const ctx = cloudSaveContext;
  const gameData = globalScene?.gameData;
  if (!ctx || !gameData) {
    return;
  }

  const db = getFirestore(ctx.app);
  const inboxRef = collection(db, "gifts", ctx.user.uid, "inbox");
  let snapshot: Awaited<ReturnType<typeof getDocs>>;
  try {
    snapshot = await getDocs(inboxRef);
  } catch (err) {
    console.error("Checking gift inbox failed:", err);
    return;
  }
  if (snapshot.empty) {
    return;
  }

  const received: string[] = [];
  const natureAttr = allNatureAttr();
  const starterIds = new Set(speciesDataRegistry.getAllStarters());

  for (const gift of snapshot.docs) {
    const data = gift.data() as GiftPayload & { fromEmail?: string };
    const from = data.fromEmail || "알 수 없음";
    if (data.kind === "voucher" && typeof data.voucherType === "number" && data.voucherType in VoucherType) {
      const voucherType = data.voucherType;
      gameData.voucherCounts[voucherType] = (gameData.voucherCounts[voucherType] ?? 0) + 1;
      received.push(`바우처 (${VoucherType[voucherType]}) - ${from}`);
    } else if (
      data.kind === "pokemon"
      && typeof data.speciesId === "number"
      && speciesDataRegistry.data[data.speciesId]
    ) {
      const { speciesId } = data;
      unlockDexEntry(gameData, speciesId, natureAttr);
      if (starterIds.has(speciesId)) {
        unlockStarterEntry(gameData, speciesId);
      }
      received.push(`${speciesDataRegistry.getSpecies(speciesId).getName()} - ${from}`);
    }
    await deleteDoc(gift.ref).catch(err => console.error("Failed to clear claimed gift:", err));
  }

  if (received.length > 0) {
    await gameData.saveSystem();
    alert(`선물을 받았습니다!\n\n${received.join("\n")}`);
  }
}
