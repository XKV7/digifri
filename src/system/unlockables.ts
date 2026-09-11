import { GameMode } from "#app/game-mode";
import { GameModes } from "#enums/game-modes";
import { Unlockables } from "#enums/unlockables";
import i18next from "i18next";

export function getUnlockableName(unlockable: Unlockables) {
  switch (unlockable) {
    case Unlockables.ENDLESS_MODE:
      return i18next.t("gameMode:mode", { mode: GameMode.getModeName(GameModes.ENDLESS) });
    case Unlockables.MINI_BLACK_HOLE:
      return i18next.t("modifierType:ModifierType.MINI_BLACK_HOLE.name");
    case Unlockables.SPLICED_ENDLESS_MODE:
      return i18next.t("gameMode:mode", { mode: GameMode.getModeName(GameModes.SPLICED_ENDLESS) });
    case Unlockables.EVIOLITE:
      return i18next.t("modifierType:ModifierType.EVIOLITE.name");
    case Unlockables.HEAVENLY_FLUTE:
      // Hardcoded rather than i18next.t("modifierType:FormChangeItem.HEAVENLY_FLUTE") - that key
      // intermittently failed to resolve in practice (observed showing the raw numeric enum value
      // instead of the translated name), so this bypasses the lookup entirely for guaranteed-correct
      // text until that's root-caused.
      return "천계의 피리";
  }
}
