/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The global leaderboard panel: a floating DOM overlay (same plain-HTML pattern as
 * pvp-room-panel.ts — see that file's header for why this is kept out of Phaser's UI mode stack
 * entirely) showing the top 10 accounts for each tracked stat (see leaderboard.ts). Read-only and
 * one-shot per tab (fetched when that tab is first opened, not live-subscribed — a leaderboard
 * doesn't need to update while the player is looking at it).
 */

import { fetchLeaderboardTop, type LeaderboardCategory, type LeaderboardEntry } from "#app/leaderboard";
import { getPlayTimeString } from "#utils/common";

let panelEl: HTMLDivElement | undefined;

const TABS: { category: LeaderboardCategory; label: string; formatValue: (value: number) => string }[] = [
  { category: "classicBestTimeSeconds", label: "클래식 최단 기록", formatValue: getPlayTimeString },
  { category: "endlessMaxWave", label: "엔드리스 최대 도달 층", formatValue: value => `${value}층` },
  { category: "pvpWins", label: "PvP 대전 최다승", formatValue: value => `${value}승` },
];

/** Closes the panel, if currently open. */
export function closeLeaderboardPanel(): void {
  panelEl?.remove();
  panelEl = undefined;
}

function ensurePanel(): HTMLDivElement {
  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "leaderboard-panel";
    panelEl.style.cssText =
      "position:fixed;top:8px;right:8px;z-index:9999;width:300px;max-width:min(300px,92vw);"
      + "max-height:90vh;overflow-y:auto;padding:10px;border-radius:10px;box-sizing:border-box;"
      + "background:rgba(20,20,28,0.92);color:#fff;font-family:sans-serif;font-size:12px;"
      + "line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,0.5);";
    document.body.appendChild(panelEl);
  }
  return panelEl;
}

async function renderTab(el: HTMLDivElement, tabIndex: number): Promise<void> {
  const tab = TABS[tabIndex];

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  const title = document.createElement("strong");
  title.textContent = "글로벌 리더보드";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style.cssText =
    "cursor:pointer;font-size:11px;padding:4px 8px;border-radius:6px;border:none;background:#555;color:#fff;";
  closeBtn.onclick = () => closeLeaderboardPanel();
  header.append(title, closeBtn);

  const tabRow = document.createElement("div");
  tabRow.style.cssText = "display:flex;gap:4px;margin-bottom:8px;";
  TABS.forEach((t, i) => {
    const btn = document.createElement("button");
    btn.textContent = t.label;
    const active = i === tabIndex;
    btn.style.cssText =
      "cursor:pointer;font-size:10px;padding:4px 6px;border-radius:6px;border:none;flex:1;"
      + `background:${active ? "#3d5a80" : "#3a3a44"};color:#fff;`;
    btn.onclick = () => void renderTab(el, i);
    tabRow.appendChild(btn);
  });

  const listEl = document.createElement("div");
  listEl.textContent = "불러오는 중...";

  el.replaceChildren(header, tabRow, listEl);

  const entries = await fetchLeaderboardTop(tab.category);
  // The panel may have been closed (or switched to a different tab) while this was in flight.
  if (!panelEl || panelEl !== el || !el.contains(listEl)) {
    return;
  }

  if (entries.length === 0) {
    listEl.textContent = "기록이 아직 없습니다.";
    return;
  }

  const table = document.createElement("div");
  entries.forEach((entry: LeaderboardEntry, rank: number) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;gap:8px;padding:3px 0;"
      + (rank < entries.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.1);" : "");
    const rankAndName = document.createElement("span");
    rankAndName.textContent = `${rank + 1}. ${entry.displayName}`;
    rankAndName.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const value = document.createElement("span");
    value.textContent = tab.formatValue(entry.value);
    value.style.cssText = "flex-shrink:0;color:#a0c4ff;";
    row.append(rankAndName, value);
    table.appendChild(row);
  });
  listEl.replaceChildren(table);
}

/** Opens (or re-renders) the leaderboard panel, starting on the first tab. */
export function openLeaderboardPanel(): void {
  const el = ensurePanel();
  void renderTab(el, 0);
}
