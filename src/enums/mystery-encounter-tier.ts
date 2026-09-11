/**
 * Enum values are base spawn weights of each tier.
 * The weights aim for 46.25/31.25/18.5/4% spawn ratios, AFTER accounting for anti-variance and pity mechanisms
 * (MASTER was added on top of that original 4-tier split - see BattleScene#getMysteryEncounter -
 * as an even rarer tier above ROGUE, currently only used by the Arceus Trial encounter).
 */
export enum MysteryEncounterTier {
  COMMON = 66,
  GREAT = 40,
  ULTRA = 19,
  ROGUE = 3,
  MASTER = 1,
}
