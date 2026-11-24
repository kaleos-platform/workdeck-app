# Sentry 자동 수정 — 수정 대상 선정 품질 개선

작성 2026-11-24. 상위: `2026-11-21-sentry-autofix-loop.md`(Phase 3 dry). 관련: `2026-11-24-sentry-autofix-token-refresh.md`.

## 배경 (실측, 2026-11-24)

dry 첫 실행에서 13건 중 10건이 `insufficient-no-exception-frame`. 운영 후보 16건의 최신 이벤트 구조를 GET 으로만 조사했다(메시지·사용자 정보 미출력).

| 유형                    | 이슈                                                                                                                                                                                          | 원인                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 클라이언트, 압축 청크만 | APP-10, APP-11 (+W, Z 프레임 0~2)                                                                                                                                                             | **클라이언트 소스맵이 업로드되지 않음.** 배포 청크는 `/_next/static/immutable/chunks/*.js` 이고 `//# debugId=` 는 들어 있다. 그러나 artifact bundle(최신 5532파일)은 `~/chunks`·`~/app`·`~/edge`·`instrumentation`·`middleware` 뿐이고 `_next/static` 파일이 0개. 서버 debugId(대조군)는 bundle 10개에서 조회되지만, 운영 클라이언트 debugId(`133dc173…`)와 APP-11 debugId는 0개. `@sentry/nextjs` 10.39 의 turbopack 기본 assets 는 `static/chunks/**` 인데 Vercel 의 Next 16.3 출력은 `static/immutable/chunks` (로컬 `next build` 는 `static/chunks` — Vercel 빌드에서만 다름). APP-10(11-15)은 토큰 교체(11-21) 전이라 원래 없음 |
| 메시지만(예외 없음)     | 1J `[product-items] 적재 실패`, 1G `Bad uncompressed size`, 1C `RangeError: Maximum call stack`, 1F `[heartbeat] 발송 실패:`, 1K `[heartbeat] HTTP 500`, 1B `[coupang-write-poller] 잡 실패:` | `console.error('라벨', 문자열)` 형태 → 스택 없음. 1F·1K·1B 는 `worker/` (수정 금지 영역)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 라이브러리 프레임만     | 1E Prisma `DriverAdapterError`, 1M Supabase `AuthApiError`, 1D unhandledrejection                                                                                                             | `console.error(err)` 의 err 스택이 라이브러리 안에서 시작 → in-app 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| in-app 오판             | 1N(`/opt/rust/nodejs.js`, `/var/task/___next_launcher.cjs`), 1P(`sentry.server.config.ts`)                                                                                                    | Vercel 런타임 파일·Sentry 설정 파일이 in-app 으로 표시 → Codex 를 돌려도 고칠 곳이 없음                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## 목표

1. 클라이언트 오류가 원본 파일·줄로 보이게 한다(앱 설정, main 릴리스 필요).
2. 러너가 "고칠 위치를 특정할 수 없는 이슈"에 Codex 를 쓰지 않고, 특정할 수 있는 이슈는 놓치지 않는다.
3. Slack·pending 에 이유를 구체적으로 남겨 1주 검토(12-01)에서 판단할 수 있게 한다.

## 변경 A — 클라이언트 소스맵 업로드 (앱, PR 1개 → develop → main)

- `next.config.ts` `withSentryConfig` 에 `sourcemaps.assets` 명시. 사용자 값이 기본 목록을 **통째로 대체**하므로(`getBuildPluginOptions.js`: `assets: sentryBuildOptions.sourcemaps?.assets ?? 기본`) 서버 경로도 함께:
  `['.next/server/**', '.next/static/**']`. 기본 ignore(`static/chunks/main-*` 등 제외 목록)와 업로드 후 `.map` 삭제(`static/**/*.map`)는 그대로 적용된다.
- `widenClientFileUpload` 는 `static/chunks` 기준이라 해결이 안 된다. `@sentry/nextjs` 11.x 업그레이드는 메이저라 이번 범위 밖(별도 검토).
- 검증: develop 머지 → preview 배포 후 ① preview 의 클라이언트 청크 하나에서 `debugId` 를 읽고 ② artifact-bundles `?query=<debugId>` 가 1개 이상(서버 대조군과 같은 방식) ③ `<chunk>.js.map` 이 공개 URL 에서 404(삭제됨) ④ bundle 파일 수 증가. main 릴리스 후 운영에서 같은 확인 + 이후 클라이언트 이벤트에 `js_no_source` 가 없는지.
- 위험: 업로드 파일 수 증가(빌드 시간 약간). `.map` 공개 노출 — 기본 삭제 패턴이 `static/**` 이라 immutable 도 포함(③으로 확인). 롤백: 설정 줄 revert.

## 변경 B — 러너 선정 (스크립트, PR 1개 → develop, 운영 체크아웃 pull)

1. **in-app 정제** (`lib.mjs` `hasUsableException`·`extractFacts`): in-app 프레임 중 저장소 소스로 매핑되지 않는 것을 제외 —
   `/opt/`, `/var/task/`, `node:`, `node_modules/`, `<anonymous>`, 빈 파일명, `sentry.*.config.ts`, `instrumentation*.ts`.
   남는 게 없으면 `insufficient`.
2. **라벨 위치 찾기**: 예외 프레임이 없거나 라이브러리 프레임뿐일 때, 메시지 맨 앞 `[라벨]`(정규식 `^\[[\w-]{2,40}\]`)을 **수정 허용 경로 코퍼스**(`loadCorpus`, `src|app|components` 의 ts/tsx)에서 찾는다.
   - 정확히 1개 파일에서만 나오면 그 파일·줄을 `locator` 로 컨텍스트에 넣고 진행(Codex 지시: "이 로그 호출부가 원인 객체를 버리거나 문자열만 넘긴다면 그것부터 확인").
   - 0개면: 저장소 전체(코퍼스 밖)에서 나오는지 호스트 `git grep -F` 로 확인 → `worker/` 등 금지·비허용 경로면 `blocked-label-path`(Codex 미실행), 아니면 `insufficient-no-locator`.
   - 2개 이상이면 `insufficient-ambiguous-label`.
   - 라벨 문자열은 scrub 된 메시지에서만 취하고, 컨텍스트에는 라벨·파일·줄만(메시지 나머지 미포함).
3. **이유 코드 세분화**: `insufficient-no-exception-frame` 을 `insufficient-minified-no-sourcemap`(platform javascript + `js_no_source`), `insufficient-library-only`, `insufficient-message-only`, `insufficient-runtime-frames` 로 나눠 Slack 요약에 유형별 개수.
4. 테스트: 위 표의 유형마다 픽스처(구조만, 가짜 값) → 기대 상태·이유. 라벨 1개/0개/2개/금지 경로.

## 하지 않는 것

- 앱 코드의 `console.error(label, msg)` 를 `console.error(label, err)` 로 바꾸는 일(1B·1F·1J 등)은 러너가 locator 로 Codex 에게 맡기거나, 금지 영역(`worker/`)은 사람이 별도 작업.
- 소스맵 원문을 러너가 받아 오는 일(Sentry 가 처리 후 이벤트에 원본 프레임을 넣어 줌).

## 단계

1. A: next.config 수정 → lint·build → develop PR·머지 → preview 검증(위 ①~④) → main 릴리스 → 운영 검증.
2. B: TDD 로 lib/run 수정 → 단위·통합 테스트 → develop PR·머지 → 운영 체크아웃 pull(이미지 재빌드 불필요 — 호스트 스크립트만. 프롬프트 변경 시 codex 이미지 재빌드 여부 확인).
3. 다음 04:30 dry 실행 Slack 요약에서 유형별 개수 확인.

## 롤백

- A: `sourcemaps` 줄 revert(develop→main). 업로드된 bundle 은 그대로 둬도 무해.
- B: develop revert 후 운영 체크아웃 pull.

## Codex 계획 검토 반영 (2026-11-24, 지적 5건 — 반영 5)

1. [high] turbopack 업로드는 glob 을 펼치지 않고 CLI 에 경로를 그대로 넘긴다 → **반영**: `assets: ['.next/server', '.next/static']`(디렉터리). 구현 전 `getBuildPluginOptions.js`·CLI 호출부에서 디렉터리 인자 처리 재확인. preview 검증에 **서버 debugId 조회(대조군)도 포함** — 서버·클라이언트 둘 다 bundle 에 있어야 통과.
2. [high] 404 한 건으로 .map 공개 노출을 막을 수 없다 → **반영**: `deleteSourcemapsAfterUpload: true` 를 명시하고, `package.json` build 스크립트 끝에 **fail-closed 검사**(`.next/static` 아래 `.map` 이 하나라도 남으면 exit 1 → 배포 중단). preview 에서 빌드 매니페스트의 청크 여러 개 `.map` URL 이 모두 404 인지 확인. 노출되면 해당 배포 삭제(Vercel)를 롤백 절차에 포함.
3. [high] locator 경로에도 title·message 가 Codex 로 간다 → **반영**: locator 경로 컨텍스트는 `저장소에서 확인된 라벨 문자열 + 파일 + 줄 + exception.type(safeType)` 만으로 따로 구성, title·message·route 제외. 주입 문자열·scrub 통과 PII 가 담긴 픽스처로 Codex 입력(context 파일)에 안 들어가는지 테스트.
4. [medium] `loadCorpus` 는 경로·줄이 없는 합친 문자열 → **반영**: base commit 에서 `git grep -n -F -e <라벨>` (추적 파일) 결과를 경로·줄 단위로 받고 `isAllowedPath && !isForbiddenPath` 로 나눈다. 판정: 허용 1줄만 → locator / 허용 0 + 금지·비허용 ≥1 → `blocked-label-path` / 허용 ≥2 줄 또는 허용·금지 동시 → `insufficient-ambiguous-label` / 0 → `insufficient-no-locator` / grep 실패 → `insufficient-locator-error`. 각각 테스트.
5. [medium] 새 분류의 기록·한도 미정 → **반영**: 새 이유는 모두 status `insufficient`(Codex 미실행, pending 미생성, 일일 처리 한도 미소비, 다음 날 재선정 허용 — 비용 없음). 1주 검토용으로 `runs/<runId>/selection.json` 에 이슈별 `{shortId, status, reason}` 만 기록(메시지 없음)하고 Slack 요약에 이유별 개수. locator 로 진행한 이슈는 기존 경로대로 한도 소비·pending 생성.

## 구현 메모 (변경 A)

- fail-closed 검사는 `package.json` build 가 아니라 `vercel.json` `buildCommand` 끝에 둔다 — Vercel 은 `next build` 를 직접 실행해 npm build 스크립트를 거치지 않는다. 검사 조각은 `.map` 있을 때 exit 1, 없을 때 exit 0 을 로컬에서 확인.
- 디렉터리 인자 재확인 완료: `handleRunAfterProductionCompile` → `uploadSourcemaps(prepareArtifacts:false)` 는 `sourcemaps.assets` 를 glob 없이 sentry-cli 에 그대로 넘긴다(`bundler-plugin-core` direct upload 분기). 상대 경로는 빌드 cwd(프로젝트 루트) 기준.
- preview 검증은 develop 머지 전 **PR 브랜치 preview** 에서 먼저 한다(Preview 환경에 `SENTRY_AUTH_TOKEN`·`SENTRY_ORG`·`SENTRY_PROJECT` 있음 확인).
