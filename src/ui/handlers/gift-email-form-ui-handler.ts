/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type GiftPayload, getCloudSaveContext, sendGift } from "#app/gift";
import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";

export interface GiftFormConfig extends ModalConfig {
  giftPayload: GiftPayload;
}

/** Asks for a recipient's Google account email, then sends the gift chosen by the caller (see gift.ts). */
export class GiftEmailFormUiHandler extends FormModalUiHandler {
  override getModalTitle(): string {
    return "선물 받는 사람";
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
    return [{ label: "받는 사람 Google 이메일" }];
  }

  override show(args: [GiftFormConfig, ...any]): boolean {
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
      const email = this.inputs[0]?.text ?? "";
      const ctx = getCloudSaveContext();
      if (!ctx) {
        globalScene.ui.setMode(
          UiMode.GIFT_EMAIL_FORM,
          Object.assign(config, { errorMessage: "클라우드 저장(Google 로그인)이 필요합니다." }),
        );
        globalScene.ui.playError();
        return;
      }

      globalScene.ui.setMode(UiMode.LOADING, { buttonActions: [] });
      sendGift(ctx.app, ctx.user, email, config.giftPayload).then(result => {
        if (result.ok) {
          globalScene.ui.playSelect();
          for (const input of this.inputs) {
            input.setText("");
          }
          onSent(result.message);
        } else {
          globalScene.ui.setMode(UiMode.GIFT_EMAIL_FORM, Object.assign(config, { errorMessage: result.message }));
          globalScene.ui.playError();
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
