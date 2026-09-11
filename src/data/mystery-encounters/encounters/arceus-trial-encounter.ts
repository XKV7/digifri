/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Unlockables } from "#enums/unlockables";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/arceusTrial";

/**
 * The Arceus Trial encounter - a rare battle against a wild Arceus. Winning permanently unlocks
 * the Heavenly Flute (see legend-plate.ts) into the normal Master-tier reward pool, mirroring how
 * Mini Black Hole is unlocked (see init-modifier-pools.ts).
 */
export const ArceusTrialEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ARCEUS_TRIAL,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withMaxAllowedEncounters(1)
  .withFleeAllowed(true)
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.ARCEUS,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      scale: 1.25,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    const config: EnemyPartyConfig = {
      pokemonConfigs: [
        {
          species: speciesDataRegistry.getSpecies(SpeciesId.ARCEUS),
          isBoss: true,
          bossSegments: 3,
          nature: Nature.HARDY,
          moveSet: [MoveId.JUDGMENT, MoveId.RECOVER, MoveId.CALM_MIND, MoveId.EARTHQUAKE],
        },
      ],
    };

    encounter.enemyPartyConfigs = [config];
    encounter.setDialogueToken("arceusName", speciesDataRegistry.getSpecies(SpeciesId.ARCEUS).getName());

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => {
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      setEncounterRewards({ fillRemaining: true });
      encounter.onRewards = async () => {
        if (!globalScene.gameData.isUnlocked(Unlockables.HEAVENLY_FLUTE)) {
          globalScene.phaseManager.unshiftNew("UnlockPhase", Unlockables.HEAVENLY_FLUTE);
        }
      };
      encounter.dialogue.outro = [{ text: `${namespace}:outro` }];
      await transitionMysteryEncounterIntroVisuals(true, true, 500);
      await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    },
    async () => {
      leaveEncounterWithoutBattle();
      return true;
    },
  )
  .build();
