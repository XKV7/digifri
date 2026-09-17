/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { SpeciesId } from "#enums/species-id";
import { getDexNumber } from "#utils/pokemon-utils";
import { describe, expect, it } from "vitest";

/**
 * Regression coverage for getDexNumber(). It's used to render "No.XXXX" on the Summary screen, the
 * Pokedex list/detail pages, the Starter Select screen, and the egg-hatch info container. Its
 * generic `speciesId % 2000` mapping (meant for real regional-form species, which share their base
 * species' dex number) collides with this fork's own custom, cheat-only species IDs the same way
 * it already needed a special case for MissingNo. (9000): Adeus (9001) and Ingingi (6974) aren't
 * regional forms of anything, but their IDs fall in the same numeric ranges regional forms use -
 * without a special case, Ingingi's own 6974 % 2000 = 974 rendered "No.0974", Psyduck's real dex
 * number, on every one of those screens instead of Ingingi's own identity.
 */
describe("getDexNumber", () => {
  it("returns 0 for MissingNo., matching its own in-universe dex #000 identity", () => {
    expect(getDexNumber(SpeciesId.MISSING_NO)).toBe(0);
  });

  it("returns Adeus's own full numeric ID rather than colliding with a real species' dex number", () => {
    expect(getDexNumber(SpeciesId.ADEUS)).toBe(SpeciesId.ADEUS);
  });

  it("returns Ingingi's own full numeric ID rather than colliding with a real species' dex number", () => {
    expect(getDexNumber(SpeciesId.INGINGI)).toBe(SpeciesId.INGINGI);
  });

  it("still applies the plain modulo mapping for a real regional-form species (regression guard)", () => {
    // Hisuian Growlithe (6058) shares its base species' (Growlithe) real dex number.
    expect(getDexNumber(SpeciesId.HISUI_GROWLITHE)).toBe(SpeciesId.GROWLITHE);
  });
});
