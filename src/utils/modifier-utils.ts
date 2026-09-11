import { modifierTypes } from "#data/data-lists";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import {
  dailyStarterModifierPool,
  enemyBuffModifierPool,
  modifierPool,
  trainerModifierPool,
  wildModifierPool,
} from "#modifiers/modifier-pools";
import type { ModifierType } from "#modifiers/modifier-type";
import type { ModifierPool, ModifierTypeFunc } from "#types/modifier-types";

export function getModifierPoolForType(poolType: ModifierPoolType): ModifierPool {
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      return modifierPool;
    case ModifierPoolType.WILD:
      return wildModifierPool;
    case ModifierPoolType.TRAINER:
      return trainerModifierPool;
    case ModifierPoolType.ENEMY_BUFF:
      return enemyBuffModifierPool;
    case ModifierPoolType.DAILY_STARTER:
      return dailyStarterModifierPool;
  }
}

// TODO: document this
export function getModifierType(modifierTypeFunc: ModifierTypeFunc): ModifierType {
  const modifierType = modifierTypeFunc();
  if (!modifierType.id) {
    modifierType.id = Object.keys(modifierTypes).find(k => modifierTypes[k] === modifierTypeFunc)!; // TODO: is this bang correct?
  }
  return modifierType;
}

/**
 * The Phaser texture key to draw a {@linkcode ModifierType}'s icon from. "items" (the shared
 * texture-packer atlas - see assets/images/items.png/.json) for everything except
 * `FormChangeItem.HEAVENLY_FLUTE`, which has its own standalone (non-atlas) texture instead
 * (custom-assets/images/heavenly_flute.png, loaded in loading-scene.ts) - mirrors
 * getVoucherTypeIconTexture() in voucher.ts for the exact same reason: adding a real new icon to
 * the shared atlas would mean editing a file that's fetched fresh from upstream on every deploy
 * (see .github/workflows/deploy-pages.yml), which risks every other item's icon along with it if
 * done wrong.
 *
 * @remarks
 * Deliberately duck-types (checking for a `formChangeItem` property) instead of an `instanceof
 * FormChangeItemModifierType` check - that class lives in modifier-type.ts, and a value import of
 * it from modifier.ts (the other caller of this function) would create a real circular import
 * (modifier.ts -> modifier-type.ts -> daily-run.ts -> challenge.ts -> battle.ts -> modifier.ts).
 * Every caller that draws a `ModifierType`'s icon should resolve its texture through this rather
 * than assuming "items" - pass the result as the sprite's texture key, and only pass
 * `type.iconImage` as the frame when this returns `"items"` (`undefined` otherwise, so the whole
 * standalone texture is used).
 */
export function getModifierTypeIconTexture(type: ModifierType): string {
  const formChangeItem = (type as { formChangeItem?: FormChangeItem }).formChangeItem;
  return formChangeItem === FormChangeItem.HEAVENLY_FLUTE ? "heavenly_flute" : "items";
}
