import { loggedInUser } from "#app/account";
import { FAKE_TITLE_LOGO_CHANCE } from "#app/constants";
import { claimDailyReward } from "#app/daily-reward";
import { getCloudSaveContext } from "#app/gift";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { resubmitLeaderboardStats } from "#app/leaderboard";
import { fetchOnlinePlayerCount } from "#app/presence";
import { promptPendingPvpInvite } from "#app/pvp-invite";
import { isBeta, isDev } from "#constants/app-constants";
import { PlayerGender } from "#enums/player-gender";
import type { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { version } from "#package.json";
import { TimedEventDisplay } from "#ui/event-display";
import { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { addTextObject } from "#ui/text";
import { fixedInt, randInt } from "#utils/common";
import i18next from "i18next";

export class TitleUiHandler extends OptionSelectUiHandler {
  private titleContainer: Phaser.GameObjects.Container;
  private usernameLabel: Phaser.GameObjects.Text;
  private playerCountLabel: Phaser.GameObjects.Text;
  private splashMessage: string;
  private splashMessageText: Phaser.GameObjects.Text;
  private eventDisplay: TimedEventDisplay;
  private appVersionText: Phaser.GameObjects.Text;

  private titleStatsTimer: NodeJS.Timeout | null;

  /**
   * Returns the username of logged in user. If the username is hidden, the trainer name based on gender will be displayed.
   * @returns The username of logged in user
   */
  private getUsername(): string {
    const usernameReplacement = i18next.t(
      globalScene.gameData.gender === PlayerGender.FEMALE ? "trainerNames:playerF" : "trainerNames:playerM",
    );

    // The offline save itself always lives under the fixed "Guest" username (baked into every
    // localStorage key), so prefer the signed-in Google account's own name/email for display
    // when cloud save is active, rather than showing that internal placeholder.
    const cloudUser = getCloudSaveContext()?.user;
    const displayName = globalScene.hideUsername
      ? usernameReplacement
      : (cloudUser?.displayName ?? cloudUser?.email ?? loggedInUser?.username ?? i18next.t("common:guest"));

    return i18next.t("menu:loggedInAs", { username: displayName });
  }

  updateUsername() {
    this.usernameLabel.setText(this.getUsername());
  }

  constructor(mode: UiMode = UiMode.TITLE) {
    super(mode);
  }

  setup() {
    super.setup();

    const ui = this.getUi();

    const scaledHeight = globalScene.scaledCanvas.height;
    const scaledWidth = globalScene.scaledCanvas.width;

    this.titleContainer = globalScene.add
      .container(0, -scaledHeight) // formatting
      .setName("title")
      .setAlpha(0);
    ui.add(this.titleContainer);

    const logo = globalScene.add
      .image(scaledWidth / 2, 8, this.getLogo()) // formatting
      .setOrigin(0.5, 0);

    if (timedEventManager.isEventActive()) {
      this.eventDisplay = new TimedEventDisplay(0, 0, timedEventManager.activeEvent());
      this.eventDisplay.setup();
      this.titleContainer.add(this.eventDisplay);
    }

    const labelPosX = scaledWidth - 2;
    // Actual y positions will be determined after the title menu has been populated with options
    this.usernameLabel = addTextObject(labelPosX, 0, this.getUsername(), TextStyle.MESSAGE, { fontSize: "54px" }) // formatting
      .setOrigin(1, 0);

    this.playerCountLabel = addTextObject(labelPosX, 0, `? ${i18next.t("menu:playersOnline")}`, TextStyle.MESSAGE, {
      // formatting
      fontSize: "54px",
    }).setOrigin(1, 0);

    const logoX = logo.x;
    const logoHeight = logo.y + logo.displayHeight;

    this.splashMessageText = addTextObject(logoX + 64, logoHeight - 8, "", TextStyle.MONEY, { fontSize: "54px" })
      .setOrigin()
      .setAngle(-20);

    globalScene.tweens.add({
      targets: this.splashMessageText,
      duration: fixedInt(350),
      scale: "*=1.25",
      loop: -1,
      yoyo: true,
    });

    this.appVersionText = addTextObject(logoX - 60, logoHeight + 4, "", TextStyle.MONEY, { fontSize: "54px" }) // formatting
      .setOrigin();

    this.titleContainer.add([
      logo,
      this.usernameLabel,
      this.playerCountLabel,
      this.splashMessageText,
      this.appVersionText,
    ]);
  }

  updateTitleStats(): void {
    // The real pokerogue.net "players online" stat is unreachable from this self-hosted fork, so
    // the online count instead comes from this project's own Firestore presence heartbeat (see
    // presence.ts) - null (signed out, or the fetch failed) leaves the existing "?" label as-is.
    fetchOnlinePlayerCount().then(count => {
      if (count != null) {
        this.playerCountLabel.setText(`${count} ${i18next.t("menu:playersOnline")}`);
      }
    });
  }

  /** Used solely to display a random Pokémon name in a splash message. */
  randomPokemon(): void {
    const rand = randInt(1025, 1);
    const pokemon = speciesDataRegistry.getSpecies(rand as SpeciesId);
    const splashMessage = this.splashMessage;
    if (
      this.splashMessage === "splashMessages:underratedPokemon"
      || this.splashMessage === "splashMessages:dontTalkAboutThePokemonIncident"
      || this.splashMessage === "splashMessages:aWildPokemonAppeared"
      || this.splashMessage === "splashMessages:aprilFools.removedPokemon"
    ) {
      this.splashMessageText.setText(i18next.t(splashMessage, { pokemonName: pokemon.name }));
    }
  }

  /** Used for a specific April Fools splash message. */
  genderSplash(): void {
    const splashMessage = this.splashMessage;
    if (this.splashMessage === "splashMessages:aprilFools.helloKyleAmber") {
      const splashMessageText = this.splashMessageText;
      const text = globalScene.gameData.gender === PlayerGender.MALE ? "trainerNames:playerM" : "trainerNames:playerF";
      splashMessageText.setText(i18next.t(splashMessage, { name: i18next.t(text) }));
    }
  }

  show(args: any[]): boolean {
    const ret = super.show(args);

    if (!ret) {
      return false;
    }

    const scaledHeight = globalScene.scaledCanvas.height;
    const windowHeight = this.getWindowHeight();

    this.updateUsername();

    // Moving username and player count to top of the menu
    // and sorting it, to display the shorter one on top
    const UPPER_LABEL = scaledHeight - 23 - windowHeight;
    const LOWER_LABEL = scaledHeight - 13 - windowHeight;

    if (this.usernameLabel.width < this.playerCountLabel.width) {
      this.usernameLabel.setY(UPPER_LABEL);
      this.playerCountLabel.setY(LOWER_LABEL);
    } else {
      this.usernameLabel.setY(LOWER_LABEL);
      this.playerCountLabel.setY(UPPER_LABEL);
    }

    // Pinned to a fixed announcement instead of the usual random splash message pool (see
    // splash-messages.ts) - this.splashMessage is left as "" so none of the special-case handlers
    // below (updateTitleStats/randomPokemon/genderSplash) ever match and overwrite it.
    this.splashMessage = "";
    this.splashMessageText.setText("학교이메일은 비번고치세요");

    const betaText = isBeta || isDev ? " (Beta)" : "";
    this.appVersionText.setText("v" + version + betaText);

    const ui = this.getUi();

    if (timedEventManager.isEventActive()) {
      this.eventDisplay.setWidth(globalScene.scaledCanvas.width - this.optionSelectBg.width - this.optionSelectBg.x);
      this.eventDisplay.show();
    }

    const now = new Date();
    if (now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15)) {
      this.getSnow();
    }

    this.randomPokemon();
    this.genderSplash();

    this.updateTitleStats();
    resubmitLeaderboardStats();
    void promptPendingPvpInvite();
    void claimDailyReward();

    this.titleStatsTimer = setInterval(() => {
      this.updateTitleStats();
    }, 60000);

    globalScene.tweens.add({
      targets: [this.titleContainer, ui.getMessageHandler().bg],
      duration: fixedInt(325),
      alpha: (target: any) => (target === this.titleContainer ? 1 : 0),
      ease: "Sine.easeInOut",
    });

    return true;
  }

  clear(): void {
    super.clear();

    const ui = this.getUi();

    this.eventDisplay?.clear();

    this.titleStatsTimer && clearInterval(this.titleStatsTimer);
    this.titleStatsTimer = null;

    globalScene.tweens.add({
      targets: [this.titleContainer, ui.getMessageHandler().bg],
      duration: fixedInt(325),
      alpha: (target: any) => (target === this.titleContainer ? 0 : 1),
      ease: "Sine.easeInOut",
    });
  }

  /**
   * Get the logo file path to load, with a 0.1% chance to use the fake logo instead.
   * @returns The path to the image.
   */
  private getLogo(): string {
    // Invert spawn chances on april fools
    const aprilFools = timedEventManager.isAprilFoolsActive();
    return aprilFools === !!randInt(FAKE_TITLE_LOGO_CHANCE) ? "logo_fake" : "logo";
  }

  private snow: Phaser.GameObjects.TileSprite;

  /** Adds a snow effect on the title screen during the winter season. */
  private getSnow(): void {
    const width = globalScene.scaledCanvas.width;
    const height = globalScene.scaledCanvas.height;
    this.snow?.destroy(); // Ensures no duplicate snow layers
    this.snow = globalScene.add.tileSprite(width, height, width, height, "snow");
    this.snow.setOrigin(1, 1);

    globalScene.tweens.add({
      targets: this.snow,
      tilePositionX: { from: 0, to: -512 },
      tilePositionY: { from: 0, to: -512 },
      duration: 100000,
      repeat: -1,
      yoyo: false,
      ease: "Linear",
      onUpdate: () => {
        if (this.snow) {
          this.snow.tilePositionX -= 0.5;
          this.snow.tilePositionY -= 0.5;
        }
      },
    });
    this.titleContainer.addAt(this.snow, 0);
  }
}
