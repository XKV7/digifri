/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { OptionSelectUiHandler } from "#ui/settings/option-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

type MenuUiHandlerPrivates = {
  openPvpDeckMenu(index: number, deck: unknown, isActive: boolean): Promise<void>;
};

/**
 * Regression coverage for a freeze reported when selecting an empty PvP deck slot from the deck
 * list ("메뉴 > PvP 팀 등록" > "덱 2 (비어있음)").
 *
 * Both the deck-list menu and its per-deck submenu render via the same shared UiMode.OPTION_SELECT
 * handler instance. BaseOptionSelectUiHandler#processInput() calls this.clear() on that handler
 * right after an option's handler() returns. openPvpTeamMenu()'s deck options call
 * `ui.revertMode(); void this.openPvpDeckMenu(...)` without awaiting the revert - if
 * openPvpDeckMenu() ran fully synchronously, its own `ui.setOverlayMode(UiMode.OPTION_SELECT, ...)`
 * call would render the submenu and then have it immediately wiped (config nulled, container
 * hidden) by that same processInput() call's own trailing clear() - leaving the screen on a blank,
 * unresponsive overlay. openPvpDeckMenu() now `await`s a resolved promise first specifically to
 * avoid this.
 */
describe("PvP deck-list -> submenu navigation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("the submenu survives the deck-list handler's own clear() after selecting a deck", async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();

    await globalScene.ui.setOverlayMode(UiMode.MENU);
    const menuHandler = globalScene.ui.handlers[UiMode.MENU] as unknown as MenuUiHandlerPrivates;

    // Mirrors openPvpTeamMenu()'s own deck-2 (empty) option exactly: ui.revertMode() is NOT
    // awaited, immediately followed by a call into openPvpDeckMenu().
    const options = [
      {
        label: "덱 2 (비어있음)",
        handler: () => {
          void globalScene.ui.revertMode();
          void menuHandler.openPvpDeckMenu(1, null, false);
          return true;
        },
      },
    ];
    await globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options });

    const optionSelectHandler = globalScene.ui.getHandler() as OptionSelectUiHandler;
    optionSelectHandler.processInput(Button.ACTION);

    // Let the deferred openPvpDeckMenu() call (a microtask) run.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(globalScene.ui.getMode()).toBe(UiMode.OPTION_SELECT);
    const handlerState = optionSelectHandler as any;
    expect(handlerState.config).not.toBeNull();
    expect(handlerState.config.options.map((o: { label: string }) => o.label)).toEqual(["편집하기", "Cancel"]);
    expect(handlerState.optionSelectContainer.visible).toBe(true);
  }, 15000);
});
