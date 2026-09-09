/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The player list panel: a floating DOM overlay (same plain-HTML pattern as
 * pvp-room-panel.ts/leaderboard-panel.ts - see pvp-room-panel.ts's header for why this is kept
 * out of Phaser's UI mode stack entirely) listing every account that's ever signed in, by display
 * name, with a "초대" button to send them a direct PvP invite (see pvp-invite.ts). An account
 * with a run currently in progress shows "런 진행중" instead of an invite button - PvP is
 * title-screen-only (see menu-ui-handler.ts hiding PVP_LOBBY mid-run), so inviting them wouldn't
 * be actionable yet.
 *
 * Opened from the title screen's main menu ("목록보기" - see title-phase.ts's showOptions()).
 * Read-only aside from the invite action; one-shot fetch per open, not live-subscribed (a roster
 * doesn't need to update while the player is looking at it - reopen to refresh).
 */

import { getCloudSaveContext } from "#app/gift";
import { myDisplayName } from "#app/leaderboard";
import { fetchAllPresence, type PresenceEntry } from "#app/presence";
import { promptPendingPvpInvite, sendPvpInvite } from "#app/pvp-invite";

let panelEl: HTMLDivElement | undefined;

/** Closes the panel, if currently open. */
export function closeFriendListPanel(): void {
  panelEl?.remove();
  panelEl = undefined;
}

function ensurePanel(): HTMLDivElement {
  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "friend-list-panel";
    panelEl.style.cssText =
      "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;"
      + "width:360px;max-width:min(360px,92vw);max-height:80vh;overflow-y:auto;padding:12px;"
      + "border-radius:10px;box-sizing:border-box;background:rgba(20,20,28,0.94);color:#fff;"
      + "font-family:sans-serif;font-size:12px;line-height:1.4;box-shadow:0 4px 20px rgba(0,0,0,0.6);";
    document.body.appendChild(panelEl);
  }
  return panelEl;
}

async function render(el: HTMLDivElement): Promise<void> {
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  const title = document.createElement("strong");
  title.textContent = "플레이어 목록";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "닫기";
  closeBtn.style.cssText =
    "cursor:pointer;font-size:11px;padding:4px 8px;border-radius:6px;border:none;background:#555;color:#fff;";
  closeBtn.onclick = () => closeFriendListPanel();
  header.append(title, closeBtn);

  const listEl = document.createElement("div");
  listEl.textContent = "불러오는 중...";

  el.replaceChildren(header, listEl);

  const ctx = getCloudSaveContext();
  const myName = myDisplayName();
  if (!ctx || !myName) {
    listEl.textContent = "로그인 후 이용할 수 있습니다.";
    return;
  }

  const roster = await fetchAllPresence();
  // The panel may have been closed while this was in flight.
  if (!panelEl || panelEl !== el || !el.contains(listEl)) {
    return;
  }

  const others = roster
    .filter(entry => entry.uid !== ctx.user.uid)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName));

  if (others.length === 0) {
    listEl.textContent = "다른 플레이어가 아직 없습니다.";
    return;
  }

  const table = document.createElement("div");
  others.forEach((entry: PresenceEntry, i: number) => {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;"
      + (i < others.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.1);" : "");

    const nameWrap = document.createElement("span");
    nameWrap.style.cssText =
      "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;";
    const dot = document.createElement("span");
    dot.style.cssText = `display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${entry.online ? "#4caf50" : "#666"};`;
    const nameText = document.createElement("span");
    nameText.textContent = entry.displayName;
    nameWrap.append(dot, nameText);

    let actionEl: HTMLElement;
    if (entry.inRun) {
      const status = document.createElement("span");
      status.textContent = "런 진행중";
      status.style.cssText = "color:#999;font-size:11px;flex-shrink:0;";
      actionEl = status;
    } else {
      const inviteBtn = document.createElement("button");
      inviteBtn.textContent = "초대";
      inviteBtn.style.cssText =
        "cursor:pointer;font-size:11px;padding:3px 8px;border-radius:6px;border:none;flex-shrink:0;background:#3d5a80;color:#fff;";
      inviteBtn.onclick = async () => {
        inviteBtn.disabled = true;
        inviteBtn.textContent = "전송 중...";
        const ok = await sendPvpInvite(entry.uid, myName);
        inviteBtn.textContent = ok ? "초대 보냄" : "실패";
        if (!ok) {
          inviteBtn.disabled = false;
        }
      };
      actionEl = inviteBtn;
    }

    row.append(nameWrap, actionEl);
    table.appendChild(row);
  });
  listEl.replaceChildren(table);
}

/** Opens (or re-renders) the player list panel. */
export function openFriendListPanel(): void {
  const el = ensurePanel();
  void render(el);
  // Also a natural opportunity to pick up any PvP invite that arrived since the title screen loaded.
  void promptPendingPvpInvite();
}
