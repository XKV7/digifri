/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getValidLegendaryGachaSpecies } from "#data/egg";
import { Button } from "#enums/buttons";
import type { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { PokemonIconAnimHelper, PokemonIconAnimMode } from "#ui/pokemon-icon-anim-helper";
import { ScrollBar } from "#ui/scroll-bar";
import { addTextObject } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import { ScrollableGridHelper } from "#ui/utils/scrollable-grid-helper";

/**
 * Scrollable species-icon grid picker. Originally built to let the player
 * pick a specific legendary to "pin" as the Legendary Gacha's featured
 * pickup (opened from the Egg Gacha screen via {@linkcode Button.STATS}),
 * also reused as a generic species picker (e.g. the Pokémon gift flow in
 * gift.ts) via the optional species list argument.
 *
 * `show(args)` expects:
 * - `args[0]`: callback invoked with the chosen {@linkcode SpeciesId}, or
 *   `null` if the player cleared the pin ({@linkcode Button.STATS}) or cancelled.
 * - `args[1]` (optional): the species list to show. Defaults to the
 *   legendary-gacha-eligible species.
 * - `args[2]` (optional): instruction text override.
 */
export class LegendaryPickerUiHandler extends MessageUiHandler {
  private readonly ROWS = 6;
  private readonly COLUMNS = 9;

  private pickerContainer: Phaser.GameObjects.Container;
  private iconContainer: Phaser.GameObjects.Container;
  private icons: Phaser.GameObjects.Sprite[];
  private nameText: Phaser.GameObjects.Text;
  private pinnedIndicatorText: Phaser.GameObjects.Text;
  private instructionText: Phaser.GameObjects.Text;
  private messageBoxContainer: Phaser.GameObjects.Container;

  private cursorObj: Phaser.GameObjects.Image;
  private scrollGridHandler: ScrollableGridHelper;
  private iconAnimHandler: PokemonIconAnimHelper;

  private speciesList: SpeciesId[];
  private onPick: (speciesId: SpeciesId | null) => void;

  constructor() {
    super(UiMode.LEGENDARY_PICKER);
  }

  setup(): void {
    const ui = this.getUi();

    this.pickerContainer = globalScene.add.container(0, -globalScene.scaledCanvas.height).setVisible(false);
    ui.add(this.pickerContainer);

    const bgColor = globalScene.add
      .rectangle(0, 0, globalScene.scaledCanvas.width, globalScene.scaledCanvas.height, 0x006860)
      .setOrigin(0);

    this.iconAnimHandler = new PokemonIconAnimHelper();
    this.iconAnimHandler.setup();

    this.nameText = addTextObject(8, 8, "", TextStyle.SUMMARY).setOrigin(0);
    this.pinnedIndicatorText = addTextObject(8, 24, "", TextStyle.WINDOW_ALT).setOrigin(0);
    this.instructionText = addTextObject(
      8,
      globalScene.scaledCanvas.height - 20,
      "Z: 픽업 선택   C: 자동(오늘의 전설)로 되돌리기   X: 취소",
      TextStyle.WINDOW_ALT,
    ).setOrigin(0);

    this.iconContainer = globalScene.add.container(8, 40);

    this.cursorObj = globalScene.add.image(0, 0, "select_cursor").setOrigin(0);

    const scrollBar = new ScrollBar(8 + this.COLUMNS * 18 + 4, 40, 4, this.ROWS * 18, this.ROWS);

    this.scrollGridHandler = new ScrollableGridHelper(this, this.ROWS, this.COLUMNS)
      .withScrollBar(scrollBar)
      .withUpdateGridCallBack(() => this.updateIcons())
      .withUpdateSingleElementCallback((i: number) => this.setDetails(i));

    this.messageBoxContainer = globalScene.add.container(0, globalScene.scaledCanvas.height).setVisible(false);
    const messageBox = addWindow(1, -1, 318, 28).setOrigin(0, 1);
    this.messageBoxContainer.add(messageBox);

    // Message isn't used, but is expected to exist as this subclasses MessageUiHandler
    this.message = addTextObject(8, -8, "", TextStyle.WINDOW, { maxLines: 1 }).setActive(false).setVisible(false);

    this.cursor = -1;

    this.pickerContainer.add([
      bgColor,
      addWindow(1, 1, globalScene.scaledCanvas.width - 2, globalScene.scaledCanvas.height - 2),
      this.nameText,
      this.pinnedIndicatorText,
      this.instructionText,
      this.iconContainer,
      this.cursorObj,
      scrollBar,
    ]);
  }

  override show(args: any[]): boolean {
    super.show(args);

    this.onPick = args[0];
    this.speciesList = (args[1] as SpeciesId[] | undefined) ?? getValidLegendaryGachaSpecies();
    this.instructionText.setText(
      (args[2] as string | undefined) ?? "Z: 픽업 선택   C: 자동(오늘의 전설)로 되돌리기   X: 취소",
    );

    this.initIcons();

    this.getUi().bringToTop(this.pickerContainer);
    this.pickerContainer.setVisible(true);

    this.scrollGridHandler.setTotalElements(this.speciesList.length);

    this.updateIcons();
    this.setCursor(0);

    return true;
  }

  private initIcons(): void {
    this.icons = [];
    for (let i = 0; i < Math.min(this.ROWS * this.COLUMNS, this.speciesList.length); i++) {
      const x = (i % this.COLUMNS) * 18;
      const y = Math.floor(i / this.COLUMNS) * 18;
      const icon = globalScene.add.sprite(x, y, "pokemon_icons_0").setScale(0.5).setOrigin(0);
      this.iconContainer.add(icon);
      this.icons.push(icon);
    }
  }

  private updateIcons(): void {
    const indexOffset = this.scrollGridHandler.getItemOffset();
    const toShow = Math.min(this.icons.length, this.speciesList.length - indexOffset);
    this.icons.forEach((icon, i) => {
      if (i !== this.cursor) {
        this.iconAnimHandler.addOrUpdate(icon, PokemonIconAnimMode.NONE);
      }
      if (i < toShow) {
        const species = speciesDataRegistry.getSpecies(this.speciesList[i + indexOffset]);
        icon.setTexture(species.getIconAtlasKey(), species.getIconId(false)).setVisible(true);
      } else {
        icon.setVisible(false);
      }
    });
  }

  private setDetails(index: number): void {
    const speciesId = this.speciesList[index];
    const species = speciesDataRegistry.getSpecies(speciesId);
    this.nameText.setText(species.getName());
    this.pinnedIndicatorText.setText(globalScene.gameData.pinnedLegendarySpecies === speciesId ? "현재 픽업 중" : "");
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();
    let success = false;

    switch (button) {
      case Button.CANCEL:
        ui.revertMode();
        success = true;
        break;
      case Button.ACTION: {
        const speciesId = this.speciesList[this.cursor + this.scrollGridHandler.getItemOffset()];
        // Revert first: onPick may itself open another overlay (e.g. the gift
        // email form), which must land on top of whatever's below this picker,
        // not on top of this (about to be popped) picker.
        ui.revertMode();
        this.onPick(speciesId);
        success = true;
        break;
      }
      case Button.STATS:
        ui.revertMode();
        this.onPick(null);
        success = true;
        break;
      default:
        success = this.scrollGridHandler.processInput(button);
        break;
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  setCursor(cursor: number): boolean {
    const lastCursor = this.cursor;
    const changed = super.setCursor(cursor);

    if (changed) {
      const icon = this.icons[cursor];
      // cursorObj lives in pickerContainer while icon lives in iconContainer (offset (8, 40)
      // within pickerContainer), so that offset must be added back in here.
      this.cursorObj.setPositionRelative(icon, 7, 39);

      if (lastCursor > -1 && this.icons[lastCursor]) {
        this.iconAnimHandler.addOrUpdate(this.icons[lastCursor], PokemonIconAnimMode.NONE);
      }
      this.iconAnimHandler.addOrUpdate(icon, PokemonIconAnimMode.ACTIVE);

      this.setDetails(cursor + this.scrollGridHandler.getItemOffset());
    }

    return changed;
  }

  clear(): void {
    super.clear();
    this.scrollGridHandler.reset();
    this.cursor = -1;
    this.pickerContainer.setVisible(false);
    this.iconAnimHandler.removeAll();
    this.iconContainer.removeAll(true);
    this.icons = [];
  }
}
