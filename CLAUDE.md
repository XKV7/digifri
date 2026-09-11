# CLAUDE.md

## 라이선스 준수 체크리스트 (매 업데이트마다 필수 확인)

이 저장소(`XKV7/digifri`)는 PokéRogue를 포크한 것으로, 핵심 코드는 **AGPL-3.0-only**로
라이선스되어 있다 (`/LICENSE`, `/REUSE.toml` 참고). 이 프로젝트에 어떤 변경을 하든
(기능 추가/버그 수정/리팩터링 등, 크기 불문) **커밋하기 전에 아래 항목을 확인**하고,
위반 소지가 발견되면 작업을 완료했다고 보고하기 전에 사용자에게 알릴 것.

### 1. AGPL 13조 - 네트워크 소스 공개 의무 (가장 중요, 매번 확인)
- 배포된 게임(`https://xkv7.github.io/digifri/`)이 실제로 실행 중인 이 포크의 소스
  (`https://github.com/XKV7/digifri`)를 게임 내에서 눈에 띄게 안내하고 있는지 확인.
- **주의**: `src/ui/handlers/menu-ui-handler.ts`의 커뮤니티 메뉴 "GitHub" 링크는
  원래 원본 upstream `pagefaultgames/pokerogue`를 가리키던 코드다. 이 포크만의
  수정사항이 담긴 저장소로 연결되도록 유지/확인할 것 (아직 실제로 고치지 않았다면
  최우선으로 처리 - 2026-09-11 기준 발견된 미해결 이슈).
- 새로운 소셜/커뮤니티 UI를 추가할 때도 소스 링크가 여전히 노출돼 있는지 같이 점검.

### 2. 새 파일의 SPDX 헤더
- `src/**/*.ts`, `test/**/*.ts` 등에 새 파일을 만들 때는 파일 상단에
  ```
  /*
   * SPDX-FileCopyrightText: 2026 NONE
   *
   * SPDX-License-Identifier: AGPL-3.0-only
   */
  ```
  헤더를 붙인다 (이 세션에서 추가한 `src/data/legend-plate.ts` 등과 동일한 패턴).
  헤더가 없어도 `REUSE.toml`의 디렉터리 기본 규칙(AGPL-3.0-only)이 적용되긴 하지만,
  일관성을 위해 명시적으로 붙이는 쪽을 기본으로 한다.

### 3. 기존 저작권/라이선스 고지 보존
- 기존 파일의 SPDX 헤더, 저작권 고지, `LICENSES/`나 `REUSE.toml`의 매핑을 임의로
  지우거나 바꾸지 않는다.

### 4. 외부 코드를 가져와 쓸 때
- 다른 오픈소스 프로젝트(예: Google, Vitest 등)의 코드를 복사/변형해서 쓸 경우
  `src/utils/color-utils.ts`, `test/reporters/custom-default-reporter.ts`처럼
  `SPDX-SnippetBegin` / `SPDX-SnippetCopyrightText` / `SPDX-License-Identifier`
  주석으로 원저작권자와 실제 라이선스를 명시한다. 라이선스가 AGPL과 양립 불가능한
  코드(예: 카피레프트가 더 강하거나 비허용 조건이 붙은 경우)는 가져오지 않는다.

### 5. 로고/브랜드 자산
- `assets` 저장소의 PokéRogue 로고 계열 파일은 `LicenseRef-NO-REUSE`(재사용 금지,
  공식 보증 암시 우려)로 표시돼 있다. 게임 내부에서 원래 의도대로(타이틀 로고 등)
  쓰는 것은 괜찮지만, 이 로고를 게임 밖 다른 용도(마케팅, 별도 웹사이트 등)로 쓰거나
  "공식 PokéRogue/Pagefault Games 프로젝트"인 것처럼 오해시키는 문구를 추가하지 않는다.

### 보고 방식
각 업데이트 작업을 완료 보고할 때, 위 5개 항목 중 새로 걸리는 게 있으면 짧게 같이
언급한다. 문제 없으면 굳이 매번 "라이선스 문제 없음"이라고 길게 설명할 필요는 없고,
이상이 있을 때만 알리면 된다.
