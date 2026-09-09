/*
 * SPDX-FileCopyrightText: 2026 NONE
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Static, checked-in changelog shown in-game (see changelog-panel.ts). Not tied to
 * package.json's version - this fork doesn't bump that per deploy, so entries are keyed by date
 * instead. Newest entry first. Add a new entry here alongside any user-visible change.
 */
export interface ChangelogEntry {
  date: string;
  changes: string[];
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    date: "2026-09-09",
    changes: [
      "타이틀 화면에 '목록보기' 메뉴 추가 - 다른 플레이어 목록을 보고 PvP 대전을 초대할 수 있음",
      "클래식 모드 리더보드가 매달 1일 초기화되도록 변경 (엔드리스는 그대로 누적)",
      "MissingNo.의 종족값을 150/150/150/150/150/150으로 상향",
      "해변 바이옴에서 MissingNo.가 더블 배틀일 때 확률이 두 배로 뻥튀기되던 버그 수정 (정확히 1/512로 등장)",
    ],
  },
];
