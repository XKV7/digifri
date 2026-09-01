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

import { revokeSpeciesEntry } from "#app/cheats";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import type { SpeciesId } from "#enums/species-id";
import type { GameData } from "#system/game-data";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { VoucherType } from "#system/voucher";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";
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

/** What the sender's UI asks for. Enriched with a snapshot of the actual data before it's sent — see sendGift(). */
export type GiftPayload =
  | { kind: "voucher"; voucherType: VoucherType; count: number }
  | { kind: "pokemon"; speciesId: SpeciesId };

/** Firestore doesn't support bigint, so seenAttr/caughtAttr/ribbons are stored as strings. */
interface DexSnapshot {
  seenAttr: string;
  caughtAttr: string;
  natureAttr: number;
  seenCount: number;
  caughtCount: number;
  hatchedCount: number;
  ivs: number[];
  ribbons: string;
}

/** The gift documents actually written to/read from `gifts/{uid}/inbox/{id}`. */
type StoredGift =
  | { kind: "voucher"; voucherType: VoucherType; count: number; fromEmail: string; createdAt: number }
  | {
      kind: "pokemon";
      speciesId: SpeciesId;
      dexSnapshot: DexSnapshot;
      starterSnapshot?: StarterDataEntry;
      fromEmail: string;
      createdAt: number;
    };

function serializeDexEntry(entry: DexEntry): DexSnapshot {
  return {
    seenAttr: entry.seenAttr.toString(),
    caughtAttr: entry.caughtAttr.toString(),
    natureAttr: entry.natureAttr,
    seenCount: entry.seenCount,
    caughtCount: entry.caughtCount,
    hatchedCount: entry.hatchedCount,
    ivs: [...entry.ivs],
    ribbons: entry.ribbons.toJSON(),
  };
}

/** Merges a sender's dex snapshot into the recipient's own entry (union of attrs, max of counts/IVs) rather than overwriting it, so the recipient never loses dex progress they already had. */
function mergeDexSnapshot(gameData: GameData, speciesId: SpeciesId, snap: DexSnapshot): void {
  const seenAttr = BigInt(snap.seenAttr);
  const caughtAttr = BigInt(snap.caughtAttr);
  const ribbons = RibbonData.fromJSON(snap.ribbons);

  const existing = gameData.dexData[speciesId];
  if (!existing) {
    gameData.dexData[speciesId] = {
      seenAttr,
      caughtAttr,
      natureAttr: snap.natureAttr,
      seenCount: snap.seenCount,
      caughtCount: snap.caughtCount,
      hatchedCount: snap.hatchedCount,
      ivs: [...snap.ivs],
      ribbons,
    };
    return;
  }

  existing.seenAttr |= seenAttr;
  existing.caughtAttr |= caughtAttr;
  existing.natureAttr |= snap.natureAttr;
  existing.seenCount = Math.max(existing.seenCount, snap.seenCount);
  existing.caughtCount = Math.max(existing.caughtCount, snap.caughtCount);
  existing.hatchedCount = Math.max(existing.hatchedCount, snap.hatchedCount);
  existing.ivs = existing.ivs.map((v, i) => Math.max(v, snap.ivs[i] ?? 0));
  existing.ribbons = new RibbonData(existing.ribbons.getRibbons() | ribbons.getRibbons());
}

/** Merges a sender's starter snapshot into the recipient's own entry (candy adds, flags union, everything else takes the max) rather than overwriting it. */
function mergeStarterSnapshot(gameData: GameData, speciesId: SpeciesId, snap: StarterDataEntry): void {
  const existing = gameData.starterData[speciesId];
  if (!existing) {
    gameData.starterData[speciesId] = { ...snap };
    return;
  }

  existing.moveset = existing.moveset ?? snap.moveset;
  existing.eggMoves |= snap.eggMoves;
  existing.candyCount += snap.candyCount;
  existing.friendship = Math.max(existing.friendship, snap.friendship);
  existing.abilityAttr |= snap.abilityAttr;
  existing.passiveAttr |= snap.passiveAttr;
  existing.valueReduction = Math.max(existing.valueReduction, snap.valueReduction);
  existing.classicWinCount = Math.max(existing.classicWinCount, snap.classicWinCount);
}

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

  // Gifts transfer ownership: the sender must currently hold what they're giving, and it's
  // deducted from their own account below only once the gift is confirmed sent (never
  // before — if the send fails, the sender keeps it).
  const gameData = globalScene?.gameData;
  if (!gameData) {
    return { ok: false, message: "게임이 아직 로딩되지 않았습니다." };
  }
  const dexEntry = payload.kind === "pokemon" ? gameData.dexData[payload.speciesId] : undefined;
  if (payload.kind === "pokemon" && !dexEntry?.caughtAttr) {
    return { ok: false, message: "이 포켓몬을 보유하고 있지 않아 선물할 수 없습니다." };
  }
  if (payload.kind === "voucher") {
    if (!Number.isInteger(payload.count) || payload.count <= 0) {
      return { ok: false, message: "수량은 1 이상의 정수여야 합니다." };
    }
    if ((gameData.voucherCounts[payload.voucherType] ?? 0) < payload.count) {
      return { ok: false, message: "보유한 바우처 수량보다 많이 보낼 수 없습니다." };
    }
  }

  // Snapshot the sender's actual dex/starter state now, before it's zeroed out below, so the
  // recipient receives the same shinies/IVs/nature/candy/abilities the sender actually had
  // instead of a generic "everything unlocked" placeholder.
  const starterEntry = payload.kind === "pokemon" ? gameData.starterData[payload.speciesId] : undefined;
  const storedGift: StoredGift =
    payload.kind === "voucher"
      ? {
          kind: "voucher",
          voucherType: payload.voucherType,
          count: payload.count,
          fromEmail: fromUser.email ?? "",
          createdAt: Date.now(),
        }
      : {
          kind: "pokemon",
          speciesId: payload.speciesId,
          dexSnapshot: serializeDexEntry(dexEntry!),
          fromEmail: fromUser.email ?? "",
          createdAt: Date.now(),
          // Firestore's SDK rejects a field explicitly set to `undefined`, so a species with no
          // starter entry (a caught-only, non-starter species) must omit the key entirely rather
          // than including it as undefined.
          ...(starterEntry ? { starterSnapshot: { ...starterEntry } } : {}),
        };

  let giftDocRef: Awaited<ReturnType<typeof addDoc>>;
  try {
    giftDocRef = await addDoc(collection(db, "gifts", targetUid, "inbox"), storedGift);
  } catch (err) {
    console.error("Sending gift failed:", err);
    return { ok: false, message: "선물을 보내는 중 오류가 발생했습니다." };
  }

  // The gift is already in the recipient's inbox at this point, so a failure to save the
  // deduction locally must undo the send (restore the in-memory state and delete the inbox
  // doc) rather than report success — otherwise the sender would keep their copy while the
  // recipient also received one.
  const undo =
    payload.kind === "pokemon"
      ? snapshotSpeciesEntries(gameData, payload.speciesId)
      : snapshotVoucherCount(gameData, payload.voucherType);

  if (payload.kind === "pokemon") {
    revokeSpeciesEntry(gameData, payload.speciesId);
  } else {
    gameData.voucherCounts[payload.voucherType] -= payload.count;
  }

  const saved = await gameData.saveSystem();
  if (!saved) {
    undo();
    await deleteDoc(giftDocRef).catch(err => console.error("Failed to roll back cancelled gift:", err));
    return { ok: false, message: "저장에 실패해 선물을 취소했습니다. 다시 시도해주세요." };
  }

  return payload.kind === "pokemon"
    ? { ok: true, message: "선물을 보냈습니다! 이 포켓몬은 더 이상 내 계정에서 사용할 수 없습니다." }
    : { ok: true, message: `선물을 보냈습니다! 바우처 ${payload.count}개가 더 이상 내 계정에 없습니다.` };
}

/** Snapshots a species' dex/starter entries so a failed save can restore them exactly. */
function snapshotSpeciesEntries(gameData: GameData, speciesId: SpeciesId): () => void {
  const prevDexEntry = gameData.dexData[speciesId] ? { ...gameData.dexData[speciesId] } : undefined;
  const prevStarterEntry = gameData.starterData[speciesId] ? { ...gameData.starterData[speciesId] } : undefined;
  return () => {
    if (prevDexEntry) {
      gameData.dexData[speciesId] = prevDexEntry;
    }
    if (prevStarterEntry) {
      gameData.starterData[speciesId] = prevStarterEntry;
    }
  };
}

/** Snapshots a voucher's count so a failed save can restore it exactly. */
function snapshotVoucherCount(gameData: GameData, voucherType: VoucherType): () => void {
  const prevCount = gameData.voucherCounts[voucherType];
  return () => {
    gameData.voucherCounts[voucherType] = prevCount;
  };
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

  for (const gift of snapshot.docs) {
    const data = gift.data() as Partial<StoredGift>;
    const from = data.fromEmail || "알 수 없음";
    if (data.kind === "voucher" && typeof data.voucherType === "number" && data.voucherType in VoucherType) {
      const voucherType = data.voucherType;
      const count = typeof data.count === "number" && Number.isInteger(data.count) && data.count > 0 ? data.count : 1;
      gameData.voucherCounts[voucherType] = (gameData.voucherCounts[voucherType] ?? 0) + count;
      received.push(`바우처 (${VoucherType[voucherType]}) x${count} - ${from}`);
    } else if (
      data.kind === "pokemon"
      && typeof data.speciesId === "number"
      && speciesDataRegistry.data[data.speciesId]
      && data.dexSnapshot
    ) {
      const { speciesId } = data;
      mergeDexSnapshot(gameData, speciesId, data.dexSnapshot);
      if (data.starterSnapshot) {
        mergeStarterSnapshot(gameData, speciesId, data.starterSnapshot);
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
