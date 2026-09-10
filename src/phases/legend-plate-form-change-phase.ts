/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CommonBattleAnim } from "#data/battle-anims";
import type { SpeciesFormChange } from "#data/pokemon-forms";
import { CommonAnim } from "#enums/move-anims-common";
import type { Pokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";

/**
 * Handles Legend Plate's per-use Judgment retyping: switches Arceus into the form matching
 * `formKey`, with a brief Terastallize-style flash rather than the heavier standard form-change
 * transform sequence (see legend-plate.ts for the type-matchup logic that picks `formKey`).
 */
export class LegendPlateFormChangePhase extends BattlePhase {
  public readonly phaseName = "LegendPlateFormChangePhase";
  private readonly pokemon: Pokemon;
  private readonly formKey: string;

  constructor(pokemon: Pokemon, formKey: string) {
    super();

    this.pokemon = pokemon;
    this.formKey = formKey;
  }

  start() {
    super.start();

    new CommonBattleAnim(CommonAnim.TERASTALLIZE, this.pokemon).play(false, () => {
      this.end();
    });
  }

  async end(): Promise<void> {
    await this.pokemon.changeForm({ formKey: this.formKey } as SpeciesFormChange);
    super.end();
  }
}
