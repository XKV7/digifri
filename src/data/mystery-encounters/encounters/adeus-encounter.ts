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
import { RandomChanceRequirement } from "#mystery-encounters/mystery-encounter-requirements";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/adeusEncounter";

/**
 * The Adeus encounter - a battle against Adeus (see SpeciesId.ADEUS's own doc comment), a wholly
 * original entity meant to rival Arceus. Single phase (unlike the Arceus Trial - Adeus doesn't
 * need a mid-battle transform, it's already at full power the moment it's summoned). Catching it
 * is disabled - winning instead permanently unlocks it as a cost-10 starter (Unlockables.ADEUS).
 */
export const AdeusEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ADEUS_ENCOUNTER,
)
  .withEncounterTier(MysteryEncounterTier.MASTER)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  // Same rarity gate as the Arceus Trial - see RandomChanceRequirement's own doc comment.
  .withSceneRequirement(new RandomChanceRequirement(2048))
  .withMaxAllowedEncounters(1)
  .withFleeAllowed(true)
  .withCatchAllowed(false)
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.ADEUS,
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
          species: speciesDataRegistry.getSpecies(SpeciesId.ADEUS),
          isBoss: true,
          bossSegments: 3,
          nature: Nature.HARDY,
          moveSet: [MoveId.ROAR_OF_TIME, MoveId.SPACIAL_REND, MoveId.SHADOW_FORCE, MoveId.DRAGON_PULSE],
        },
      ],
    };

    encounter.enemyPartyConfigs = [config];
    encounter.setDialogueToken("adeusName", speciesDataRegistry.getSpecies(SpeciesId.ADEUS).getName());

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
        // Marks it seen/caught in the dex (same call a real catch would make) so its data renders
        // correctly wherever dex data is referenced, then permanently unlocks it as a starter -
        // it's never added to the player's current-run party, only made selectable in future runs.
        const adeus = globalScene.getEnemyParty()[0];
        globalScene.gameData.updateSpeciesDexIvs(adeus.species.getRootSpeciesId(true), adeus.ivs);
        await globalScene.gameData.setPokemonCaught(adeus, true, false, false);
        if (!globalScene.gameData.isUnlocked(Unlockables.ADEUS)) {
          globalScene.phaseManager.unshiftNew("UnlockPhase", Unlockables.ADEUS);
        }
      };
      // Replaces (rather than mutates) `dialogue` - `MysteryEncounter`'s constructor only shallow-
      // copies the encounter template (see its `Object.assign` call), so every instance built from
      // the same template shares one `dialogue` object; mutating `.outro` in place would leak into
      // that shared object and show this outro on every future encounter of this type for the rest
      // of the session, including ones ended via option 2's leaveEncounterWithoutBattle() below.
      encounter.dialogue = { ...encounter.dialogue, outro: [{ text: `${namespace}:outro` }] };
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
