# Workdeck Design

Workdeck UI의 단일 기준. 문장마다 근거를 표시한다.

- **[관행]** 코드에서 센 다수 패턴. 그대로 따른다.
- **[규칙]** 이 문서가 정한 기준. 새 코드부터 적용하고, 기존 코드는 그 파일을 고칠 때만 맞춘다. 일괄 교체하지 않는다.
- **[제안]** 에디 승인 전이라 적용하지 않는다.

- 우선순위: 이 문서 → 현재 코드의 같은 종류 화면 → 외부 레퍼런스(`ui-ux-pro-max`, awesome-design-md 등).
- 작업 절차: `.codex/skills/workdeck-ui/SKILL.md`(Claude Code는 `.claude/skills/workdeck-ui`로 같은 파일). 새 화면·큰 개편은 먼저 `.claude/skills/ui-plan`.
- 구조 규칙: `docs/rules/02-architecture.md` §3 (다중 선택 목록 §3.1, 테이블 컬럼 폭 §3.2).
- 수치는 2026-11-09 `develop` 기준 `src`·`app`의 `.tsx` 653개에서 클래스 이름으로 센 값이다. `dark:`·`hover:`·`md:` 같은 접두사 변형은 포함하고, `gap-1.5` 같은 소수점 변형은 따로 센다.

## 1. 성격

운영형 SaaS. 조용하고 밀도 있게, 반복 작업과 비교가 쉬워야 한다.

- [규칙] 장식보다 스캔성. 색은 의미가 있을 때만 쓴다.
- [관행] 기본 글자 크기는 작다: `text-xs` 1,622회, `text-sm` 1,482회. [규칙] `text-base` 이상은 제목·강조에만 쓴다.
- [관행] 숫자는 `tabular-nums`로 열을 맞춘다(280회).

## 2. 색

### 2.1 기본 토큰 (`app/globals.css`)

shadcn new-york, base color `neutral`. 전부 무채색이고 라이트/다크가 `:root`/`.dark`에서 바뀐다.

| 토큰                         | 용도                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `background` / `foreground`  | 페이지 바탕·본문                                                             |
| `card`, `popover`            | 표면                                                                         |
| `primary`                    | 주 버튼, 선택·활성 상태                                                      |
| `muted` / `muted-foreground` | 보조 바탕·보조 텍스트(`text-muted-foreground` 2,311회 — 가장 흔한 텍스트 색) |
| `destructive`                | 삭제·오류. 값이 Tailwind `red-600`(라이트)/`red-400`(다크)와 같다            |
| `border`, `input`, `ring`    | 선·입력 테두리·포커스 링                                                     |
| `chart-1`~`5`                | 차트 계열                                                                    |
| `sidebar-*`                  | 사이드바                                                                     |

- [규칙] 선택·활성·포커스는 `primary`/무채색 계열로 표현한다. 새 파랑·보라 강조색을 만들지 않는다.
- [규칙] 하드코딩 색(`#hex`, `rgb()`)을 새로 쓰지 않는다. 페이지 로컬 별칭이 필요하면 `.ps-root`처럼 전역 토큰에 매핑한다.

### 2.2 상태 색

상태 토큰은 아직 없고 Tailwind 기본 팔레트를 직접 쓴다. [규칙] 의미별 색조를 하나로 고정한다. 기존 코드는 섞여 있다(색조별 `text|bg|border-*` 합계: amber 390, emerald 290, red 211, green 118, blue 116, orange 53, yellow 30, indigo 25).

| 의미           | 색조                                  | 예                     |
| -------------- | ------------------------------------- | ---------------------- |
| 정상·완료·증가 | `emerald` (`green` 쓰지 않음)         | 재고 정상, 동기화 성공 |
| 주의·부족·대기 | `amber` (`yellow`·`orange` 쓰지 않음) | 재고 부족, 승인 대기   |
| 위험·결품·실패 | `red` 또는 `destructive`              | 결품, 오류             |
| 정보·과잉·보조 | `blue`                                | 안내, 과잉 재고        |

[규칙] 조합은 아래를 쓰고, 상태 색을 쓰면 `dark:` 짝을 함께 쓴다. 라이트 쪽은 [관행]과 같다(`bg-*-50` 111 > `-100` 48, `text-*-700` 177 > `-600` 141, `border-*-200` 55 > `-300` 43). 다크 쪽은 아직 굳은 관행이 없어(`dark:bg-*-950` 43 vs `-900` 34) 이 표로 정한다. 세 클래스를 모두 갖춘 기존 코드는 적다.

| 쓰임                  | 라이트                                        | 다크                                                          |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| 배경이 있는 배지·알림 | `bg-{hue}-50 border-{hue}-200 text-{hue}-700` | `dark:bg-{hue}-950 dark:border-{hue}-800 dark:text-{hue}-400` |
| 글자만                | `text-{hue}-700` (또는 `-600`)                | `dark:text-{hue}-400`                                         |

실측(상위): `text-amber-700` 74, `text-emerald-700` 67, `text-amber-400` 59, `bg-amber-50` 50, `text-red-600` 41, `bg-amber-950` 23. 기존 `green`·`orange`·`yellow`·`indigo`와 blue의 `bg-100`/`text-800` 조합은 그 파일을 고칠 때만 바꾼다.

### 2.3 [제안·보류] 상태 토큰 (미적용)

위 규칙을 토큰으로 묶는 안이다. 값은 지금 쓰는 Tailwind 색과 같아서 적용해도 화면이 바뀌지 않는다(값 출처: `node_modules/tailwindcss/theme.css`). 승인되면 `globals.css`와 `@theme inline`에 별도 PR로 넣고, 새 코드부터 쓴다.

| 토큰                           | 라이트                                                                             | 다크                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `--success` / `--success-soft` | emerald-700 `oklch(50.8% 0.118 165.612)` / emerald-50 `oklch(97.9% 0.021 166.113)` | emerald-400 `oklch(76.5% 0.177 163.223)` / emerald-950 `oklch(26.2% 0.051 172.552)` |
| `--warning` / `--warning-soft` | amber-700 `oklch(55.5% 0.163 48.998)` / amber-50 `oklch(98.7% 0.022 95.277)`       | amber-400 `oklch(82.8% 0.189 84.429)` / amber-950 `oklch(27.9% 0.077 45.635)`       |
| `--info` / `--info-soft`       | blue-700 `oklch(48.8% 0.243 264.376)` / blue-50 `oklch(97% 0.014 254.604)`         | blue-400 `oklch(70.7% 0.165 254.624)` / blue-950 `oklch(28.2% 0.091 267.935)`       |

`destructive`는 이미 있으므로 위험은 그대로 쓴다.

## 3. 글꼴과 크기

- 본문: Pretendard Variable(대체 Noto Sans KR·Apple SD Gothic Neo). 고정폭: JetBrains Mono(대체 D2Coding). `--font-geist-sans`/`--font-geist-mono` 변수 이름은 유지한다.
- [관행] 페이지 제목(`h1`): `text-2xl font-bold tracking-tight` (49회, `<h1 className>` 115개 중 최다). [규칙] 다른 변형(`text-2xl font-semibold` 11, `text-lg font-semibold` 10)은 고칠 때 이것으로 맞춘다.
- [규칙] 섹션 제목은 `text-lg font-semibold`, 카드 헤더는 `text-sm font-medium`.
- [관행] 보조 설명: `text-sm text-muted-foreground`.

## 4. 간격과 모양

- [관행] 간격 단위는 작게: `gap-2` 683 > `space-y-2` 288 > `gap-1` 286 > `space-y-1` 259 > `gap-3` 232 > `gap-1.5` 218 > `space-y-4` 206 > `space-y-3` 179. [규칙] 페이지 섹션 사이는 `space-y-4`~`space-y-6`.
- [관행] 반경: `--radius: 0.625rem`. 실사용은 `rounded-md`(461)가 기본, 카드 `rounded-lg`(158), `rounded-full`(85)은 아바타·점 등 원형.
- [규칙] 카드 안에 카드를 중첩하지 않는다. 반복 항목만 카드형 표면을 쓴다.

## 5. 컴포넌트

- [관행] 공용 프리미티브: `src/components/ui/`(25개). `@/components/ui`가 여기로 해석된다(`tsconfig.json` `paths`의 `./src/*`가 먼저). [규칙] 루트 `components/ui/`(14개)에는 새로 추가하지 않는다.
- [규칙] 새 프리미티브는 `npx shadcn@3.8.5 add <name>`(설치된 버전)으로 추가하고 `components.json` 설정을 따른다. MCP `shadcn@3.8.5 mcp`로 예제를 찾는다(등록법은 `AGENTS.md` "UI Work").
- [관행] 아이콘: `lucide-react`. [규칙] 아이콘만 있는 버튼에는 `aria-label`.
- [규칙] 새 폼은 React Hook Form + Zod(`src/lib/validations/`). 지금 RHF를 쓰는 파일은 10개뿐이라 기존 폼은 고칠 때만 옮긴다.
- [관행] 로딩: 버튼·인라인은 `Loader2` 회전(253회), 큰 영역은 `Skeleton`(16회).
- [규칙] 상태 수량은 카드 그리드보다 `Badge`·라벨·pill처럼 가벼운 표현을 먼저 쓴다.
- [규칙] 다중 선택 일괄 작업: `FloatingActionBar` — `docs/rules/02-architecture.md` §3.1.
- [규칙] 테이블 폭·고정 열·가로 스크롤: §3.2. 레퍼런스 `src/components/sh/inventory/stock-status-matrix.tsx`.

## 6. 반응형

- [관행] 실사용: `sm:` 296, `lg:` 110, `md:` 55, `xl:` 11. [규칙] 모바일과 그 이상은 `sm`, 넓은 레이아웃은 `lg`로 나눈다.
- [규칙] 모바일 폭 390px에서 텍스트가 버튼·탭·표 셀을 넘치지 않는지 확인한다. 넓은 표는 가로 스크롤 + 식별 열 고정(§3.2).

## 7. 상태 화면

- [규칙] loading, empty, no-result, error를 화면마다 따로 둔다. 빈 상태는 이유와 다음 행동(버튼·링크)을 함께 보여 준다.
- [규칙] 오류 문구는 `text-destructive`, 폼 입력 오류는 필드 아래 `FormMessage`(현재 7개 파일에서 사용).

## 8. 결정 기록

화면 방향을 고르며 버린 안과 이유를 쌓는다. 형식: `날짜 — 화면 — 고른 안 / 버린 안: 이유`.

- 2026-11-14 — 발송 메일 전체(`src/lib/email/layout.ts`) — A안 카드(연회색 바탕+흰 카드, 고객사 대상 메일은 고객사 이름 헤더·워크덱은 하단 「Workdeck으로 발송」, 로고는 이미지 없이 표 칸 「W」) / 버린 안: 상단 색 띠+이니셜(B, 이니셜이 고객사 로고처럼 보임), 카드 없는 레터(C, 정돈감 부족). 예외: 메일은 CSS 변수를 못 써서 §2.1 하드코딩 색 금지를 적용하지 않고 인라인 hex를 쓴다(브랜드 파랑 `#2563eb` = 마케팅 로고 blue-600, 나머지 zinc 무채색).
- 2026-11-14 — 상태 색 — §2.2 규칙(Tailwind 팔레트 + `dark:` 짝) 유지 / 버린 안: §2.3 상태 토큰 지금 도입 — 11-09~11-14에 새로 들어간 상태 색 12줄 중 9줄이 `dark:` 짝을 갖췄고 색조 규칙 위반(green·orange·yellow)은 0줄이라 규칙만으로 충분하고, 지금 넣으면 두 방식이 섞인다. `dark:` 짝 누락이 늘거나 상태 색을 한꺼번에 손보는 개편이 생기면 다시 검토한다.
- 2026-11-20 — 설정 화면(사이드바 설정 그룹·`/settings/*`) — 매일 쓰는 메뉴(홈·AI 요청 승인·사용 중인 업무)와 접히는 `설정` 그룹 분리, 화면 안 주제가 여럿이면 `?tab=` 탭(팀원 초대·관리), 외부 연동은 공식 로고 타일 그리드 + `?open=` 팝업(설명→키 발급 방법→입력→확인)으로 통일, 로고는 `public/brand/`(출처 README)·`<img>`만 / 버린 안: 설정 링크 하나 + 화면 안 2단 메뉴(기존 사이드바 섹션 그룹 선호와 충돌), 연동 카드 세로 나열·탭 3개(초보자가 무엇이 연결됐는지 한눈에 못 봄), simple-icons 단색 아이콘(실제 서비스 아이콘과 다름). 계획: `docs/plans/2026-11-20-settings-*.md`
- 2026-11-27 — 마케팅 사이트(workdeck.work, `app/(marketing)`) — 항상 라이트(마케팅 경로만 next-themes `forcedTheme`, 앱은 시스템 테마 유지), 브랜드 강조색 blue-600 하나는 주 CTA·작은 아이콘 강조에만(`src/components/marketing/cta-class.ts`, §2.1 「새 파랑 금지」의 마케팅 예외), 그라데이션 글자·띠·업무별 그라데이션 아이콘 제거, 홈은 좌측 정렬 히어로 + 신뢰 줄(실제 사실만) + 문제→결과 + AI + 벤토(공개 업무 큰 카드) + 3단계 + FAQ + 마지막 CTA / 버린 안: 가운데 정렬 히어로 + 업무별 교차 행(B, 준비중 업무가 많아 행이 비어 보임), 시스템 테마 따라가기(맥 다크 모드에서 어둡고 기술적으로 보여 소상공인 대상에 맞지 않음). 시안 `docs/design/plans/homepage-renewal/`
- 2026-11-28 — 모집 관리 랜딩(/recruiting)·요금제(/pricing) — 랜딩은 좌측 정렬 히어로 + 실제 화면 이미지 + 주 CTA 1개 + 신뢰 줄 + 문제→결과 카드, 요금제는 판매 중 업무 큰 카드를 맨 위·준비중 업무 작은 카드를 아래·공통 조건 칩, 공용 템플릿은 선택 필드가 있을 때만 새 배치 / 버린 안: 개편 전 배치(가운데 빈 히어로 — 무엇을 하는 도구인지 안 보임, 판매 중 카드가 준비중 4개 뒤 — 가장 늦게 보임), 「함께 쓰면 좋은 업무」 — 준비중 업무로 이탈만 만듦. 계획: `docs/superpowers/plans/2026-11-28-recruiting-pricing-structure.md`
