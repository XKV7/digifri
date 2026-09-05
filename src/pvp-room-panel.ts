/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * The PvP room panel: a floating DOM overlay (plain HTML, positioned over the canvas — same
 * pattern as cloud-save.ts's badge/login overlay, independent of Phaser's UI mode stack) that
 * covers a joined room's entire lifecycle: waiting for a guest (host only), then team preview
 * (view the opponent's registered PvP team, pick 3 of your own 6 to battle with — see
 * pvp-team.ts), then waiting on the opponent's picks, through to completion. It re-renders
 * itself in place as the room's Firestore document changes live (see pvp-room.ts).
 *
 * Kept out of Phaser entirely on purpose. Player-driven, multi-step UI shown via
 * ui.showText()/ui.setOverlayMode() only actually works if ui.mode already points at whatever
 * handler is showing it — otherwise the message/overlay just paints over the screen while
 * input keeps routing to whatever WAS active underneath. An earlier version of team preview hit
 * exactly this: it opened from a menu action that had already reverted ui.mode back to TITLE,
 * so the interactive "opponent's team" message painted over the title screen without ui.mode
 * ever moving off it — pressing what looked like this UI's own prompt could actually select a
 * title-screen option ("이어하기") and load a save slot instead. A plain DOM overlay sidesteps
 * that whole class of bug by construction: it's driven by real DOM click handlers, entirely
 * independent of Phaser's mode stack.
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { startPvpBattle as launchPvpBattle } from "#app/pvp-battle";
import {
  cancelPvpRoom,
  finishPvpTeamPreview,
  initiatePvpBattle,
  type PvpRoomWithId,
  submitPvpTeamPreviewPicks,
  subscribePvpRoom,
} from "#app/pvp-room";
import { loadPvpTeam } from "#app/pvp-team";
import type { Starter } from "#types/save-data";

let panelEl: HTMLDivElement | undefined;
let panelUnsub: (() => void) | null = null;
let selected: number[] = [];
let submitting = false;
/** Guards startPvpBattle() from firing more than once per panel-open lifecycle — the room doc can snapshot-update multiple times while status stays "battling". */
let battleLaunchAttempted = false;

/** Closes the panel and stops watching the room, if either is currently active. */
export function closePvpRoomPanel(): void {
  if (panelUnsub) {
    panelUnsub();
    panelUnsub = null;
  }
  panelEl?.remove();
  panelEl = undefined;
  selected = [];
  submitting = false;
  battleLaunchAttempted = false;
}

function ensurePanel(): HTMLDivElement {
  if (!panelEl) {
    panelEl = document.createElement("div");
    panelEl.id = "pvp-room-panel";
    panelEl.style.cssText =
      "position:fixed;top:8px;right:8px;z-index:9999;width:280px;max-width:min(280px,92vw);"
      + "max-height:90vh;overflow-y:auto;padding:10px;border-radius:10px;box-sizing:border-box;"
      + "background:rgba(20,20,28,0.92);color:#fff;font-family:sans-serif;font-size:12px;"
      + "line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,0.5);";
    document.body.appendChild(panelEl);
  }
  return panelEl;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.cssText =
    "cursor:pointer;font-size:11px;padding:4px 8px;border-radius:6px;border:none;background:#3d5a80;color:#fff;";
  btn.onclick = onClick;
  return btn;
}

/** Renders a small icon canvas for a starter's registered species/form/shiny/variant, from the already-loaded Phaser texture atlas — same lookup StarterContainer uses for its own icon sprite. */
function renderIcon(starter: Starter): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  canvas.style.cssText = "width:28px;height:28px;image-rendering:pixelated;";
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  try {
    const species = speciesDataRegistry.getSpecies(starter.speciesId);
    let atlasKey = species.getIconAtlasKey(starter.formIndex, starter.shiny, starter.variant);
    let frameName = species.getIconId(starter.female ?? false, starter.formIndex, starter.shiny, starter.variant);
    let texture = globalScene.textures.get(atlasKey);
    if (!texture.has(frameName)) {
      // The exact shiny/variant icon frame can be missing — same fallback
      // StarterContainer#checkIconId uses: fall back to the species' default (non-shiny) icon.
      atlasKey = species.getIconAtlasKey(starter.formIndex, false, starter.variant);
      frameName = species.getIconId(starter.female ?? false, starter.formIndex, false, starter.variant);
      texture = globalScene.textures.get(atlasKey);
    }
    const frame = texture.get(frameName);
    const source = frame.source.image;
    if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, 32, 32);
    }
  } catch (err) {
    console.error("Failed to render PvP panel icon:", err);
  }
  return canvas;
}

function speciesName(starter: Starter): string {
  return speciesDataRegistry.getSpecies(starter.speciesId).getName(starter.formIndex);
}

function renderHeader(title: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "font-weight:bold;margin-bottom:6px;";
  el.textContent = title;
  return el;
}

function renderStatusLine(text: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "opacity:0.85;margin-bottom:6px;";
  el.textContent = text;
  return el;
}

function renderTeamRow(team: Starter[], onClick?: (index: number) => void): HTMLDivElement {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap;";
  team.forEach((starter, i) => {
    const cell = document.createElement("div");
    const isSelected = onClick && selected.includes(i);
    cell.style.cssText =
      "display:flex;flex-direction:column;align-items:center;width:38px;padding:2px;border-radius:6px;"
      + `background:${isSelected ? "rgba(80,160,255,0.5)" : "transparent"};`
      + `border:1px solid ${isSelected ? "#7fc0ff" : "transparent"};`
      + (onClick ? "cursor:pointer;" : "");
    cell.appendChild(renderIcon(starter));
    const label = document.createElement("div");
    label.style.cssText =
      "font-size:9px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:36px;";
    label.textContent = speciesName(starter);
    cell.appendChild(label);
    if (onClick) {
      cell.dataset.index = String(i);
      cell.onclick = () => onClick(i);
    }
    row.appendChild(cell);
  });
  return row;
}

function renderWaitingForGuest(roomId: string, room: PvpRoomWithId): void {
  const panel = ensurePanel();
  panel.replaceChildren(
    renderHeader(`"${room.hostName}"의 방`),
    renderStatusLine("상대를 기다리는 중..."),
    makeButton("방 취소", () => {
      closePvpRoomPanel();
      void cancelPvpRoom(roomId);
    }),
  );
}

function renderWaitingForOpponentPicks(opponentName: string | undefined): void {
  const panel = ensurePanel();
  panel.replaceChildren(
    renderHeader("팀 선출"),
    renderStatusLine(`선택을 완료했습니다. 상대(${opponentName ?? "?"})의 선택을 기다리는 중...`),
  );
}

function renderBothDone(): void {
  const panel = ensurePanel();
  panel.replaceChildren(
    renderHeader("팀 선출 완료"),
    renderStatusLine("양쪽 다 팀 선출을 완료했습니다! 대전을 준비하는 중..."),
  );
}

function renderStartingBattle(): void {
  const panel = ensurePanel();
  panel.replaceChildren(renderHeader("대전 시작"), renderStatusLine("대전을 불러오는 중..."));
}

function renderError(message: string): void {
  const panel = ensurePanel();
  panel.replaceChildren(renderHeader("오류"), renderStatusLine(message), makeButton("닫기", closePvpRoomPanel));
}

function renderPicker(
  roomId: string,
  isHost: boolean,
  opponentName: string | undefined,
  opponentTeam: Starter[],
  myTeam: Starter[],
): void {
  const panel = ensurePanel();
  panel.replaceChildren();
  panel.appendChild(renderHeader("팀 선출"));
  panel.appendChild(renderStatusLine(`상대(${opponentName ?? "?"})의 등록 팀`));
  panel.appendChild(renderTeamRow(opponentTeam));
  panel.appendChild(renderStatusLine("내 팀 — 대전에 데려갈 3마리를 선택하세요"));
  panel.appendChild(
    renderTeamRow(myTeam, i => {
      if (selected.includes(i)) {
        selected = selected.filter(x => x !== i);
      } else if (selected.length < 3) {
        selected = [...selected, i];
      }
      renderPicker(roomId, isHost, opponentName, opponentTeam, myTeam);
    }),
  );

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = selected.length === 3 ? "확정하기" : `확정하기 (${selected.length}/3)`;
  confirmBtn.disabled = selected.length !== 3 || submitting;
  confirmBtn.style.cssText =
    "width:100%;padding:6px;border-radius:6px;border:none;font-size:12px;color:#fff;"
    + `cursor:${confirmBtn.disabled ? "not-allowed" : "pointer"};`
    + `background:${selected.length === 3 ? "#3d8bff" : "#555"};`;
  confirmBtn.onclick = () => {
    if (selected.length !== 3 || submitting) {
      return;
    }
    submitting = true;
    const picks = selected;
    void submitPvpTeamPreviewPicks(roomId, isHost, picks).then(ok => {
      submitting = false;
      if (!ok) {
        renderError("선택 제출에 실패했습니다. 다시 시도해주세요.");
      }
      // On success the live subscription below picks up the room doc now carrying our own
      // picks and re-renders into the "waiting on opponent" state on its own.
    });
  };
  panel.appendChild(confirmBtn);
}

async function renderForRoom(roomId: string, isHost: boolean, room: PvpRoomWithId): Promise<void> {
  if (room.status === "waiting") {
    renderWaitingForGuest(roomId, room);
    return;
  }
  if (room.status === "finished") {
    // Reachable directly (skipping the "both picked" transition below) if the opponent's
    // "mark finished" write reaches us before we ever saw both picks present ourselves.
    // finishPvpTeamPreview() is idempotent either way, and its own cleanup is what clears our
    // local active-room pointer regardless of which side actually caused the transition.
    renderBothDone();
    void finishPvpTeamPreview(roomId);
    setTimeout(() => closePvpRoomPanel(), 6000);
    return;
  }
  if (room.status === "battling") {
    renderStartingBattle();
    if (battleLaunchAttempted) {
      return;
    }
    battleLaunchAttempted = true;
    try {
      const result = await launchPvpBattle(room, isHost);
      if (result.ok) {
        // The battle scene has taken over the whole screen from here — nothing left for this
        // DOM overlay to show.
        closePvpRoomPanel();
      } else {
        battleLaunchAttempted = false;
        renderError(result.reason);
      }
    } catch (err) {
      // Without this, any exception thrown while constructing the battle (a bad Pokemon/held
      // item lookup, a failed asset load, ...) left the panel permanently stuck on "대전을
      // 불러오는 중..." forever — battleLaunchAttempted never reset, and the thrown error never
      // surfaced anywhere a player could see or report it.
      console.error("Failed to start PvP battle:", err);
      battleLaunchAttempted = false;
      renderError(`대전을 시작하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  if (room.status !== "team_preview") {
    return;
  }

  const myPicks = isHost ? room.hostPicks : room.guestPicks;
  const opponentPicks = isHost ? room.guestPicks : room.hostPicks;
  const opponentName = isHost ? room.guestName : room.hostName;

  if (myPicks && opponentPicks) {
    renderBothDone();
    // Fire-and-forget was silent on failure (a Firestore permission error, the room doc changing
    // underneath the transaction, ...) — the panel just sat on "대전을 준비하는 중..." forever with
    // nothing to tell the player anything went wrong, since no further room-doc change ever
    // arrives to retrigger this branch. Surface it instead.
    initiatePvpBattle(roomId).then(ok => {
      if (!ok) {
        renderError("대전을 준비하지 못했습니다. 다시 시도해주세요.");
      }
    });
    // No timed close here — the live subscription picks up the "battling" transition on its own
    // (from either side, since initiatePvpBattle is idempotent) and re-renders into the branch above.
    return;
  }
  if (myPicks) {
    renderWaitingForOpponentPicks(opponentName);
    return;
  }
  if (submitting) {
    // A snapshot can arrive mid-submit, before our own write is reflected back — leave the
    // picker as the player left it rather than reload and wipe their in-progress selection.
    return;
  }

  const opponentUid = isHost ? room.guestUid : room.hostUid;
  const [myTeam, opponentTeam] = await Promise.all([loadPvpTeam(), opponentUid ? loadPvpTeam(opponentUid) : null]);
  if (!myTeam || myTeam.length === 0 || !opponentTeam || opponentTeam.length === 0) {
    renderError("팀 정보를 불러오지 못했습니다.");
    return;
  }
  renderPicker(roomId, isHost, opponentName, opponentTeam, myTeam);
}

/**
 * Opens (or re-anchors, e.g. after reopening the menu or reloading the page) the panel for a
 * room the caller is hosting or has joined. Safe to call repeatedly — content re-renders itself
 * in place as the room's Firestore document changes live.
 */
export function openPvpRoomPanel(roomId: string, isHost: boolean): void {
  ensurePanel();
  if (panelUnsub) {
    panelUnsub();
  }
  selected = [];
  submitting = false;
  battleLaunchAttempted = false;
  panelUnsub = subscribePvpRoom(roomId, room => {
    if (!room || room.status === "cancelled") {
      closePvpRoomPanel();
      return;
    }
    void renderForRoom(roomId, isHost, room);
  });
}
