import type { ObjectValues } from "#types/type-helpers";

export const GachaType = Object.freeze({
  MOVE: 0,
  LEGENDARY: 1,
  SHINY: 2,
  /** Dedicated machine for the top-tier VoucherType.MASTER voucher - see egg-gacha-ui-handler.ts. */
  MASTER: 3,
});

export type GachaType = ObjectValues<typeof GachaType>;
