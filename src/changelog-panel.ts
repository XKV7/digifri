/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The patch notes panel: a floating DOM overlay (same plain-HTML pattern as
 * leaderboard-panel.ts/pvp-room-panel.ts) listing CHANGELOG_ENTRIES (see data/changelog.ts).
 * Purely static content - no network request, so it renders instantly and always works even
 * signed out. Triggered by a small always-visible corner badge (see showChangelogBadge(),
 * mounted once from main.ts next to cloud-save.ts's own badge).
 */

import { CHANGELOG_ENTRIES } from "#data/changelog";

let panelEl: HTMLDivElement | undefined;
let badgeEl: HTMLDivElement | undefined;

/** Closes the panel, if currently open. */
export function closeChangelogPanel(): void {
  panelEl?.remove();
  panelEl = undefined;
}

function ensurePanel(): HTMLDivElement {
  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "changelog-panel";
    panelEl.style.cssText =
      "position:fixed;top:8px;left:8px;z-index:9999;width:320px;max-width:min(320px,92vw);"
      + "max-height:80vh;overflow-y:auto;padding:10px;border-radius:10px;box-sizing:border-box;"
      + "background:rgba(20,20,28,0.92);color:#fff;font-family:sans-serif;font-size:12px;"
      + "line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,0.5);";
    document.body.appendChild(panelEl);
  }
  return panelEl;
}

function render(el: HTMLDivElement): void {
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  const title = document.createElement("strong");
  title.textContent = "패치노트";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style.cssText =
    "cursor:pointer;font-size:11px;padding:4px 8px;border-radius:6px;border:none;background:#555;color:#fff;";
  closeBtn.onclick = () => closeChangelogPanel();
  header.append(title, closeBtn);

  const list = document.createElement("div");
  if (CHANGELOG_ENTRIES.length === 0) {
    list.textContent = "아직 기록된 항목이 없습니다.";
  } else {
    CHANGELOG_ENTRIES.forEach((entry, i) => {
      const section = document.createElement("div");
      section.style.cssText =
        "padding:6px 0;" + (i < CHANGELOG_ENTRIES.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.1);" : "");
      const dateEl = document.createElement("div");
      dateEl.textContent = entry.date;
      dateEl.style.cssText = "color:#a0c4ff;font-weight:bold;margin-bottom:3px;";
      const ul = document.createElement("ul");
      ul.style.cssText = "margin:0;padding-left:16px;";
      entry.changes.forEach(change => {
        const li = document.createElement("li");
        li.textContent = change;
        ul.appendChild(li);
      });
      section.append(dateEl, ul);
      list.appendChild(section);
    });
  }

  el.replaceChildren(header, list);
}

/** Opens (or re-renders) the changelog panel. */
export function openChangelogPanel(): void {
  const el = ensurePanel();
  render(el);
}

/** Mounts the always-visible "공지사항" corner badge that opens the changelog panel. Safe to call more than once. */
export function showChangelogBadge(): void {
  if (badgeEl) {
    return;
  }
  badgeEl = document.createElement("div");
  badgeEl.id = "changelog-badge";
  badgeEl.textContent = "📋 공지사항";
  badgeEl.style.cssText =
    "position:fixed;left:6px;bottom:6px;z-index:9999;font-size:12px;line-height:1;padding:4px 6px;"
    + "border-radius:6px;background:rgba(0,0,0,0.45);color:#fff;cursor:pointer;user-select:none;opacity:0.75;font-family:sans-serif;";
  badgeEl.onclick = () => openChangelogPanel();
  document.body.appendChild(badgeEl);
}
