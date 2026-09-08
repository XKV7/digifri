import type { PlayerGender } from "#enums/player-gender";
import { TrainerType } from "#enums/trainer-type";
import { AchvTier, achvs, getAchievementDescription } from "#system/achv";
import { trainerConfigs } from "#trainers/trainer-config";
import type { ConditionFn } from "#types/common";
import i18next from "i18next";

export enum VoucherType {
  REGULAR,
  PLUS,
  PREMIUM,
  GOLDEN,
  /** New top tier, above GOLDEN - spendable only at the dedicated Master gacha machine (see egg-gacha-ui-handler.ts). */
  MASTER,
}

export class Voucher {
  public id: string;
  public voucherType: VoucherType;
  public description: string;

  private conditionFunc: ConditionFn | undefined;

  constructor(voucherType: VoucherType, description: string, conditionFunc?: ConditionFn) {
    this.description = description;
    this.voucherType = voucherType;
    this.conditionFunc = conditionFunc;
  }

  validate(args?: any[]): boolean {
    return !this.conditionFunc || this.conditionFunc(args);
  }

  /**
   * Get the name of the voucher
   * @param _playerGender - this is ignored here. It's only there to match the signature of the function in the Achv class
   * @returns the name of the voucher
   */
  getName(_playerGender: PlayerGender): string {
    return getVoucherTypeName(this.voucherType);
  }

  getIconImage(): string {
    return getVoucherTypeIcon(this.voucherType);
  }

  getTier(): AchvTier {
    switch (this.voucherType) {
      case VoucherType.REGULAR:
        return AchvTier.COMMON;
      case VoucherType.PLUS:
        return AchvTier.GREAT;
      case VoucherType.PREMIUM:
        return AchvTier.ULTRA;
      case VoucherType.GOLDEN:
        return AchvTier.ROGUE;
      case VoucherType.MASTER:
        return AchvTier.MASTER;
    }
  }
}

export function getVoucherTypeName(voucherType: VoucherType): string {
  switch (voucherType) {
    case VoucherType.REGULAR:
      return i18next.t("voucher:eggVoucher");
    case VoucherType.PLUS:
      return i18next.t("voucher:eggVoucherPlus");
    case VoucherType.PREMIUM:
      return i18next.t("voucher:eggVoucherPremium");
    case VoucherType.GOLDEN:
      return i18next.t("voucher:eggVoucherGold");
    case VoucherType.MASTER:
      return i18next.t("voucher:eggVoucherMaster");
  }
}

/**
 * The frame name to draw for the given voucher type, within whichever texture
 * getVoucherTypeIconTexture() says to draw it from. Meaningless on its own for a voucher type
 * whose texture isn't an atlas (MASTER - see getVoucherTypeIconTexture) - kept returning
 * GOLDEN's frame there anyway as a harmless fallback for any caller that only reads this and
 * assumes "items", rather than an empty string.
 */
export function getVoucherTypeIcon(voucherType: VoucherType): string {
  switch (voucherType) {
    case VoucherType.REGULAR:
      return "coupon";
    case VoucherType.PLUS:
      return "pair_of_tickets";
    case VoucherType.PREMIUM:
      return "mystic_ticket";
    case VoucherType.GOLDEN:
    case VoucherType.MASTER:
      return "golden_mystic_ticket";
  }
}

/**
 * The Phaser texture key to draw the given voucher type's icon from. "items" (a shared
 * texture-packer atlas - see assets/images/items.png/.json) for every type except MASTER, which
 * has its own standalone (non-atlas) texture instead (custom-assets/images/master_ticket.png,
 * loaded in loading-scene.ts) - adding a real new icon to the shared atlas would mean editing it
 * directly in a fork of pagefaultgames/pokerogue-assets (since it's fetched fresh on every
 * deploy - see .github/workflows/deploy-pages.yml), which risks every other item's icon along
 * with it if done wrong, so MASTER gets its own file instead.
 */
export function getVoucherTypeIconTexture(voucherType: VoucherType): string {
  return voucherType === VoucherType.MASTER ? "master_ticket" : "items";
}

export interface Vouchers {
  [key: string]: Voucher;
}

export const vouchers: Vouchers = {};

export function initVouchers() {
  for (const achv of [achvs.CLASSIC_VICTORY]) {
    const voucherType =
      achv.score >= 150
        ? VoucherType.GOLDEN
        : achv.score >= 100
          ? VoucherType.PREMIUM
          : achv.score >= 75
            ? VoucherType.PLUS
            : VoucherType.REGULAR;
    vouchers[achv.id] = new Voucher(voucherType, getAchievementDescription(achv.localizationKey));
  }

  const bossTrainerTypes = Object.keys(trainerConfigs).filter(
    tt =>
      trainerConfigs[tt].isBoss
      && trainerConfigs[tt].getDerivedType() !== TrainerType.RIVAL
      && trainerConfigs[tt].hasVoucher,
  );

  for (const trainerType of bossTrainerTypes) {
    const voucherType = trainerConfigs[trainerType].moneyMultiplier < 10 ? VoucherType.PLUS : VoucherType.PREMIUM;
    const key = TrainerType[trainerType];
    const trainerName = trainerConfigs[trainerType].name;
    const trainer = trainerConfigs[trainerType];
    const title = trainer.title ? ` (${trainer.title})` : "";
    vouchers[key] = new Voucher(voucherType, `${i18next.t("voucher:defeatTrainer", { trainerName })} ${title}`);
  }
  const voucherKeys = Object.keys(vouchers);
  for (const k of voucherKeys) {
    vouchers[k].id = k;
  }
}
