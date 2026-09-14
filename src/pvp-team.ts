/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * PvP team registration. Each cloud-signed-in account can maintain up to
 * PVP_DECK_COUNT named decks, each holding up to PLAYER_PARTY_MAX_SIZE
 * Pokemon (the same `Starter` shape/configuration the normal pre-run
 * starter select screen produces — species, ability, nature, IVs, moveset,
 * held item, etc.), stored at `pvpTeams/{uid}` as `{ decks: { "0": {...},
 * "1": {...}, "2": {...} }, activeDeckIndex, updatedAt }`. `decks` is a
 * Firestore map (not an array) specifically so `savePvpDeck` can merge-write
 * a single slot without touching the others or needing a read-modify-write
 * round trip — merging into an array field would replace the whole array.
 *
 * `activeDeckIndex` picks which deck an opponent's client actually loads to
 * build this account's side of a real battle (see `loadPvpTeam`, still
 * returning a flat `Starter[]` for that one purpose so pvp-battle.ts and
 * pvp-room-panel.ts don't need to know decks exist at all).
 *
 * A pre-deck-system document (`{ starters: Starter[], updatedAt }`, no
 * `decks` field) is treated as deck slot 0 wherever it's read - existing
 * registered teams keep working, and get naturally migrated to the new
 * shape the next time the player saves via savePvpDeck.
 *
 * Any signed-in account may read another account's team (needed to build
 * the opponent's side of a PvP battle); only the owner may write their own.
 * See firestore.rules - the `pvpTeams/{uid}` rule doesn't constrain document
 * shape, so this schema change needed no rules update.
 */

import { getCloudSaveContext } from "#app/gift";
import { globalScene } from "#app/global-scene";
import type { Starter } from "#types/save-data";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore";

export const PVP_DECK_COUNT = 3;

export interface PvpDeck {
  name: string;
  starters: Starter[];
}

interface StoredPvpTeamData {
  /** Keyed by stringified slot index ("0"/"1"/"2"), not an array - see module doc comment. */
  decks?: Record<string, PvpDeck | undefined>;
  activeDeckIndex?: number;
  /** Legacy pre-deck-system shape. */
  starters?: Starter[];
  updatedAt: number;
}

// Starter has several optional fields (female, moveset, nickname, teraType, ...) that the
// starter-select screen can leave as an explicit `undefined` rather than just omitting the key —
// the Firestore SDK rejects any value containing `undefined` outright. Round-tripping through
// JSON drops those keys entirely (JSON.stringify skips undefined properties), giving a payload
// Firestore will actually accept.
function sanitizeStarters(starters: Starter[]): Starter[] {
  return JSON.parse(JSON.stringify(starters));
}

function emptyDecks(): (PvpDeck | null)[] {
  return Array.from({ length: PVP_DECK_COUNT }, () => null);
}

export interface PvpDecksState {
  decks: (PvpDeck | null)[];
  /** Which slot an opponent's client loads for an actual battle - see loadPvpTeam. */
  activeDeckIndex: number;
}

/**
 * Loads all PVP_DECK_COUNT deck slots (null = empty) plus which one is active, for the caller's
 * own account by default, or another account's by uid (for battle/opponent-preview purposes).
 */
export async function loadPvpDecks(uid?: string): Promise<PvpDecksState> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return { decks: emptyDecks(), activeDeckIndex: 0 };
  }
  try {
    const db = getFirestore(ctx.app);
    const snapshot = await getDoc(doc(db, "pvpTeams", uid ?? ctx.user.uid));
    if (!snapshot.exists()) {
      return { decks: emptyDecks(), activeDeckIndex: 0 };
    }
    const data = snapshot.data() as StoredPvpTeamData;
    const activeDeckIndex = data.activeDeckIndex ?? 0;
    if (data.decks) {
      const decks = emptyDecks().map((_, i) => {
        const deck = data.decks?.[String(i)];
        if (!deck || !Array.isArray(deck.starters) || deck.starters.length === 0) {
          return null;
        }
        return { name: deck.name || `덱 ${i + 1}`, starters: deck.starters };
      });
      return { decks, activeDeckIndex };
    }
    // Legacy single-team document - present it as deck slot 0.
    if (Array.isArray(data.starters) && data.starters.length > 0) {
      const decks = emptyDecks();
      decks[0] = { name: "덱 1", starters: data.starters };
      return { decks, activeDeckIndex: 0 };
    }
    return { decks: emptyDecks(), activeDeckIndex };
  } catch (err) {
    console.error("Failed to load PvP decks:", err);
    return { decks: emptyDecks(), activeDeckIndex: 0 };
  }
}

/** Merge-writes just this one deck slot, leaving the other slots and activeDeckIndex untouched. */
export async function savePvpDeck(index: number, name: string, starters: Starter[]): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    const db = getFirestore(ctx.app);
    const deck: PvpDeck = { name, starters: sanitizeStarters(starters) };
    await setDoc(
      doc(db, "pvpTeams", ctx.user.uid),
      { decks: { [String(index)]: deck }, updatedAt: Date.now() },
      { merge: true },
    );
    return true;
  } catch (err) {
    console.error("Failed to save PvP deck:", err);
    return false;
  }
}

/** Marks the given deck slot as the one an opponent's client should load for an actual battle. */
export async function setActivePvpDeckIndex(index: number): Promise<boolean> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return false;
  }
  try {
    const db = getFirestore(ctx.app);
    await setDoc(doc(db, "pvpTeams", ctx.user.uid), { activeDeckIndex: index, updatedAt: Date.now() }, { merge: true });
    return true;
  } catch (err) {
    console.error("Failed to set active PvP deck:", err);
    return false;
  }
}

/**
 * Loads the caller's own currently-active PvP deck by default, or another account's by uid (for
 * battle setup) — used by pvp-battle.ts/pvp-room-panel.ts, which only ever need "the team this
 * account is bringing to a fight" and have no reason to know about the multi-deck system at all.
 */
export async function loadPvpTeam(uid?: string): Promise<Starter[] | null> {
  const ctx = getCloudSaveContext();
  if (!ctx) {
    return null;
  }
  try {
    const db = getFirestore(ctx.app);
    const snapshot = await getDoc(doc(db, "pvpTeams", uid ?? ctx.user.uid));
    if (!snapshot.exists()) {
      return null;
    }
    const data = snapshot.data() as StoredPvpTeamData;
    if (data.decks) {
      const activeDeck = data.decks[String(data.activeDeckIndex ?? 0)];
      return activeDeck && Array.isArray(activeDeck.starters) ? activeDeck.starters : null;
    }
    return Array.isArray(data.starters) ? data.starters : null;
  } catch (err) {
    console.error("Failed to load PvP team:", err);
    return null;
  }
}

/**
 * While true, StarterSelectUiHandler relaxes the normal per-run starter-cost
 * value limit and skips the run-affecting side effects (starting money reset,
 * title-screen/phase-queue changes on exit) that only make sense when the
 * screen is opened via SelectStarterPhase to actually start a run. Set by
 * beginPvpTeamEditMode()/endPvpTeamEditMode() below.
 */
let pvpTeamEditModeActive = false;

export function isPvpTeamEditMode(): boolean {
  return pvpTeamEditModeActive;
}

/**
 * The screen reused for PvP team registration (StarterSelectUiHandler) is
 * normally only ever entered via a full `ui.setMode()` that clears whatever
 * was showing before it (SelectStarterPhase, always from a freshly-cleared
 * title screen). Opening it here instead as a non-clearing `setOverlayMode()`
 * overlay (so we can cleanly `ui.revertMode()` back to wherever the menu was
 * opened from, title or mid-run) can leave the previous screen's own visuals
 * rendered underneath, occasionally visible through gaps in the starter
 * select screen's own background/instruction box.
 *
 * Explicitly hiding/restoring the underlying handler (`.clear()` on entry,
 * `.show([])` on exit) was tried here and reverted: `UiHandler#show(args)`
 * contracts vary wildly — several handlers (e.g. any OptionSelectUiHandler
 * subclass, including the title screen) require specific args and simply
 * no-op — skipping ALL their own setup, leaving nothing visible at all —
 * when called with none. That left the screen completely blank and
 * unresponsive after finishing, which is far worse than the cosmetic
 * bleed-through it was meant to fix, so it's been backed out; the rare
 * visual overlap is an accepted tradeoff for now.
 */
export function beginPvpTeamEditMode(): void {
  pvpTeamEditModeActive = true;
  // Hides the per-slot cycle buttons (form/gender/shiny/ability/nature/tera) on
  // the mobile touch pad — see the [data-pvp-edit] rule in index.css — since
  // they're not needed just to pick species and only add to an already-crowded
  // corner of the screen.
  document.getElementById("touchControls")?.setAttribute("data-pvp-edit", "1");
  // If a touch was mid-press when this screen transition happened, its
  // touchend/pointerup can be missed, leaving that direction/button "stuck"
  // held down (TouchControl#buttonLock) and unresponsive afterward — same
  // failure mode the game already guards against on window blur.
  globalScene.inputController?.loseFocus();
}

export function endPvpTeamEditMode(): void {
  pvpTeamEditModeActive = false;
  document.getElementById("touchControls")?.removeAttribute("data-pvp-edit");
  globalScene.inputController?.loseFocus();
}
