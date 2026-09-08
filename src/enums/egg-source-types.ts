export enum EggSourceType {
  GACHA_MOVE,
  GACHA_LEGENDARY,
  GACHA_SHINY,
  SAME_SPECIES_EGG,
  EVENT,
  /** Appended at the end (not inserted alongside the other GACHA_* entries) so existing saved eggs' numeric sourceType values stay stable. */
  GACHA_MASTER,
}
