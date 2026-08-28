/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getCloudSaveContext, sendGift } from "#app/gift";
import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import type { VoucherType } from "#system/voucher";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";

export interface GiftVoucherFormConfig extends ModalConfig {
  voucherType: VoucherType;
}

/** Asks for a quantity and a recipient's Google account email, then sends that many vouchers (see gift.ts). */
export class GiftVoucherFormUiHandler extends FormModalUiHandler {
  override getModalTitle(): string {
    return "바우처 선물";
  }

  override getWidth(): number {
    return 160;
  }

  override getMargin(): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  override getButtonLabels(): string[] {
    return ["보내기", "취소"];
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: "보낼 수량" }, { label: "받는 사람 Google 이메일", maxLength: 254 }];
  }

  override show(args: [GiftVoucherFormConfig, ...any]): boolean {
    if (!super.show(args)) {
      return false;
    }

    const config = args[0];
    const onSent = config.buttonActions[0];
    this.submitAction = () => {
      if (globalScene.tweens.getTweensOf(this.modalContainer).length > 0) {
        return;
      }
      this.sanitizeInputs();
      const countText = this.inputs[0]?.text ?? "";
      const email = this.inputs[1]?.text ?? "";
      const count = Number.parseInt(countText, 10);

      const fail = (errorMessage: string) => {
        globalScene.ui.setMode(UiMode.GIFT_VOUCHER_FORM, Object.assign(config, { errorMessage }));
        globalScene.ui.playError();
      };

      if (!Number.isInteger(count) || count <= 0 || String(count) !== countText.trim()) {
        fail("수량은 1 이상의 정수로 입력해주세요.");
        return;
      }

      const ctx = getCloudSaveContext();
      if (!ctx) {
        fail("클라우드 저장(Google 로그인)이 필요합니다.");
        return;
      }

      globalScene.ui.setMode(UiMode.LOADING, { buttonActions: [] });
      sendGift(ctx.app, ctx.user, email, { kind: "voucher", voucherType: config.voucherType, count }).then(result => {
        if (result.ok) {
          globalScene.ui.playSelect();
          for (const input of this.inputs) {
            input.setText("");
          }
          onSent(result.message);
        } else {
          fail(result.message);
        }
      });
    };

    const originalCancelAction = this.cancelAction;
    this.cancelAction = () => {
      globalScene.ui.playSelect();
      for (const input of this.inputs) {
        input.setText("");
      }
      originalCancelAction?.();
    };

    return true;
  }
}
