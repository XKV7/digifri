/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { FormChangeItem } from "#enums/form-change-item";
import { MAX_REGULAR_POKEMON_TYPE, MIN_REGULAR_POKEMON_TYPE, type PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";

/** Whether `pokemon` is currently holding an active Legend Plate (`FormChangeItem.LEGEND_PLATE`). */
export function hasActiveLegendPlate(pokemon: Pokemon): boolean {
  return !!globalScene.findModifier(
    m =>
      m instanceof PokemonFormChangeItemModifier
      && m.pokemonId === pokemon.id
      && m.formChangeItem === FormChangeItem.LEGEND_PLATE
      && m.active,
  );
}

/**
 * Picks the regular {@linkcode PokemonType} that is most effective (highest pure type-chart
 * multiplier) against `target`, ignoring ability-based immunities. Ties are broken by lowest
 * {@linkcode PokemonType} enum value.
 */
export function getMostEffectiveTypeAgainst(target: Pokemon): PokemonType {
  let bestType = MIN_REGULAR_POKEMON_TYPE;
  let bestMultiplier = -1;
  for (let type = MIN_REGULAR_POKEMON_TYPE; type <= MAX_REGULAR_POKEMON_TYPE; type++) {
    const multiplier = target.getAttackTypeEffectiveness(type);
    if (multiplier > bestMultiplier) {
      bestMultiplier = multiplier;
      bestType = type;
    }
  }
  return bestType;
}

/**
 * If `pokemon` is an Arceus holding an active Legend Plate, returns the form key it should switch
 * to in order to become the type most effective against `target` - or `null` if no change is
 * needed (no Legend Plate held, or already the best type).
 *
 * @remarks
 * Arceus's form list is ordered to exactly match {@linkcode PokemonType}'s enum values (index 0 is
 * Normal form, index 1 is Fighting form, etc. - the same assumption {@linkcode FormChangeItemTypeAttr}
 * relies on for Judgment's own typing), so the target type's form key can be read directly off of
 * `pokemon.species.forms` by index.
 */
export function getLegendPlateFormKey(pokemon: Pokemon, target: Pokemon): string | null {
  if (pokemon.species.speciesId !== SpeciesId.ARCEUS || !hasActiveLegendPlate(pokemon)) {
    return null;
  }

  const bestType = getMostEffectiveTypeAgainst(target);
  const newForm = pokemon.species.forms[bestType];
  if (!newForm || pokemon.formIndex === bestType) {
    return null;
  }

  return newForm.formKey;
}
