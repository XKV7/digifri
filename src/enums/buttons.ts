export enum Button {
  UP,
  DOWN,
  LEFT,
  RIGHT,
  SUBMIT,
  ACTION,
  CANCEL,
  MENU,
  STATS,
  CYCLE_SHINY,
  CYCLE_FORM,
  CYCLE_GENDER,
  CYCLE_ABILITY,
  CYCLE_NATURE,
  CYCLE_TERA,
  SPEED_UP,
  SLOW_DOWN,
  DEV_CUSTOM,
  /**
   * PvP team registration only: instantly confirms the current move selection on the moveset
   * screen without needing to scroll down to the "확정하기" entry at the bottom of the option
   * list. Added at the end (not alphabetically) since this is a numeric enum and persisted
   * keybinding settings reference these values by number.
   */
  QUICK_CONFIRM,
}
