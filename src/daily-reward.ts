/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Daily login reward for cloud-synced (Google sign-in) accounts: 3 Egg Voucher Plus, granted the
 * first time the title screen loads each day. Local-only ("이 기기에서만 플레이") play doesn't
 * get this - it's tied to the Google account specifically (see the account's own choice of
 * tracking it via Firestore rather than per-device), same as the rest of this fork's cloud-only
 * perks (gifting, leaderboard, PvP).
 *
 * "Today" is claimed via a Firestore transaction on dailyRewards/{uid} so two tabs/devices
 * racing for the same account can't both grant the reward - whichever transaction commits first
 * wins, the other's precondition (lastClaimedDate !== today) fails and it no-ops. The reward
 * itself is only granted locally (gameData.voucherCounts + saveSystem()) AFTER that transaction
 * succeeds, so a save failure just costs the player that day's claim rather than risking a
 * double-grant.
 */

import { getCloudSaveContext } from "#app/gift";
import { globalScene } from "#app/global-scene";
import { VoucherType } from "#system/voucher";
import { doc, getFirestore, runTransaction } from "firebase/firestore";

const DAILY_VOUCHER_COUNT = 3;

/** Local-date key (not UTC) so "today" lines up with the player's own clock, e.g. "2026-09-09". */
function getDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Grants today's login reward if it hasn't been claimed yet today. Safe to call every time the
 * title screen loads - no-ops quietly if already claimed, signed out, or gameData isn't loaded yet.
 */
export async function claimDailyReward(): Promise<void> {
  const ctx = getCloudSaveContext();
  const gameData = globalScene?.gameData;
  if (!ctx || !gameData) {
    return;
  }

  const today = getDateKey();
  const db = getFirestore(ctx.app);
  const rewardRef = doc(db, "dailyRewards", ctx.user.uid);

  let claimed: boolean;
  try {
    claimed = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(rewardRef);
      const lastClaimedDate = (snapshot.data() as { lastClaimedDate?: string } | undefined)?.lastClaimedDate;
      if (lastClaimedDate === today) {
        return false;
      }
      transaction.set(rewardRef, { lastClaimedDate: today });
      return true;
    });
  } catch (err) {
    console.error("Failed to claim daily reward:", err);
    return;
  }

  if (!claimed) {
    return;
  }

  gameData.voucherCounts[VoucherType.PLUS] = (gameData.voucherCounts[VoucherType.PLUS] ?? 0) + DAILY_VOUCHER_COUNT;
  await gameData.saveSystem();
  alert(`오늘의 접속 보상: 알 바우처 플러스 x${DAILY_VOUCHER_COUNT} 지급!`);
}
