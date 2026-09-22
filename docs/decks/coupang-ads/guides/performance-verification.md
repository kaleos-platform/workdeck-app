# 쿠팡 광고 관리 성능 검증

## 이번 변경

- KPI, 캠페인 catalog, 전체 날짜 범위, 기간별 성과, 목표 요약을 기존 workspace tag로 cache한다. 인증은 cache 바깥에서 매번 수행한다.
- 날짜 범위는 기간 선택과 무관하게 재사용한다. 현재 목표가 날짜에 따라 달라지는 catalog는 UTC 날짜를 key에 포함해 기존 DB Date 비교 동작을 유지한다.
- 사이드바는 `/api/campaigns?view=navigation`으로 캠페인 식별 정보만 받는다. 이동마다 요청하지 않고 mount, 창 focus, 업로드·이름 변경·삭제 알림 때 갱신한다. 원격 수집/다른 창에서 변경된 목록은 focus 또는 새 진입 시 확인한다.
- 기간별 캠페인 응답에 `summary`를 포함해 캠페인별 추가 HTTP 요청을 제거한다. 목표 요약만 실패하면 성과는 표시하고 다음 요청에서 요약을 재시도한다. 실패 결과는 cache하지 않는다.
- 업로드 transaction이 commit된 이후에는 부가정보 저장 실패도 cache를 만료한다. rollback이나 중복 확인 단계에서는 만료하지 않는다.
- 첫 화면의 데이터 유무 검사는 전체 count 대신 한 행 존재 여부를 조회한다.

새 의존성, 환경변수 필수 항목, DB schema 변경은 없다. client에 workspace 간 공유 cache를 만들지 않는다.

## 서버 시간 읽기

Network에서 `/api/campaigns`, `/api/dashboard/kpi`, 캠페인 `/overview` 요청의 Timing 또는 `Server-Timing` 응답 헤더를 확인한다.

| 지표                                    | 의미                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| auth                                    | resolveWorkspace 전체: 인증, membership, deck 활성 상태, workspace 조회 |
| data                                    | 인증 이후 데이터 조회 전체                                              |
| total                                   | Route Handler 처리 전체. middleware, 네트워크, 브라우저 렌더링 제외     |
| catalog_loader                          | catalog 원본 loader 실행 시간                                           |
| date_ranges                             | 전체 날짜 범위 DB 조회 시간                                             |
| campaign_current / campaign_previous    | 기간별 캠페인 집계 DB 조회 시간                                         |
| kpi_loader / kpi_current / kpi_previous | KPI loader 및 현재·이전 기간 집계                                       |
| target_summaries / summary_loader       | 목표 요약 조회 전체 / 실제 loader 실행                                  |
| overview_loader                         | 상세 overview 원본 loader 실행 시간                                     |

DB 조회 시간에는 connection pool 대기가 포함될 수 있다. 중첩 지표는 합산하지 않는다. loader 지표가 있으면 해당 요청 중 loader 실행을 관측한 것이며, 없으면 응답 경로에서 loader 실행을 관측하지 못한 것이다. TTL 이후 background revalidation까지 단순 hit/miss로 단정하지 않는다.

인증 시간이 크면 공통 인증·DB 연결을, 특정 집계 시간이 크면 해당 집계를 우선 조사한다. 실제 pool 크기, DB region, cold start 여부는 별도 확인한다. 관측 없이 pool 확대나 index 변경을 하지 않는다.

기존 `unstable_cache`는 [Next.js Data Cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)를 사용하며, 데이터 변경 시 [revalidateTag의 expire: 0](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) 경로를 유지한다. 설치된 Next.js 16.1.6 구현은 중첩된 unstable_cache의 cache 조회를 건너뛰므로 각 집계 cache를 중첩하지 않았다.

## 운영 측정

일반 공개 환경변수와 인증된 테스트 계정이 설정된 환경에서 실행한다. `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, `E2E_COUPANG_ADS_CAMPAIGN_ID`는 환경변수로 주입하며 문서나 로그에 값을 기록하지 않는다. 지정 캠페인은 최근 7일에 광고비 또는 매출이 있어야 한다.

```sh
PLAYWRIGHT_BASE_URL=https://app.workdeck.work E2E_COUPANG_ADS_PERF=1 npx playwright test e2e/coupang-ads-campaign-detail-perf.spec.ts --workers=1
```

배포 URL은 검증하려는 preview URL로 바꿀 수 있다. `PLAYWRIGHT_BASE_URL`을 지정하면 로컬 dev 서버를 자동 실행하지 않는다. 인증 변수가 없으면 테스트는 skip되며 성능 검증 통과로 취급하지 않는다.

성능 테스트는 첫 화면, 상세 이동, 첫 화면 재진입, 상세 재진입을 5회 반복한다. HTTP 200뿐 아니라 본문의 성과 링크·KPI와 상세 제목·차트 표시를 기다린다. 상세는 원래 제목이 동일할 수 있어 API 응답과 차트를 함께 확인한다. 요청 시간과 표시 시간은 별개다.

`coupang-ads-performance.json` attachment에 각 표본의 ms와 Server-Timing을 기록한다. 첫 화면·상세는 각각 3000ms, 두 화면의 재진입은 각각 1000ms 이하여야 한다. 각 first 표본은 문서 재탐색이며 서버 cache가 비어 있음을 보장하지 않는다. cold cache, 새 browser context, warm cache를 별도 표본으로 기록해야 한다. 중간 timeout/실패 시 저장된 표본만으로 전체 완료 처리하지 않는다.

업로드·목표 수정·이름 변경·삭제 후 갱신은 테스트 workspace에서 추가 검증한다. 열린 화면과 재진입 화면에 변경이 반영되는지, 다른 workspace 값이 섞이지 않는지 확인한다. 운영 데이터 변경 실험은 이 읽기 전용 성능 테스트에 포함하지 않는다.

## 현재 검증 범위

2026-09-13 로컬 검증 결과:

- 관련 Jest 9개 suite, 30개 테스트 통과.
- 전체 lint: 오류 0개, 경고 63개.
- 아래 임시 공개 환경값을 사용한 production build 통과.
- Playwright 3개 테스트는 인증 환경변수 미설정으로 skip. 운영 측정 결과 없음.
- 요구사항 검토와 코드 품질 검토에서 발견한 업로드 실패 후 무효화 및 목표 요약 실패 격리 문제를 수정하고 회귀 테스트로 검증.

관련 단위·컴포넌트 테스트는 실제 production DB 대신 mock을 사용한다. 반복 DB 호출 제거, 계산 결과, workspace tag 분리, 실패 후 재시도와 무효화를 검증하며 운영 응답 시간을 증명하지 않는다.

현재 worktree에는 Supabase 공개 환경변수와 E2E 인증 설정이 없다. 기본 build는 기존 `/forgot-password` prerender에서 환경변수 부족으로 실패했다. 다음 임시 값으로 컴파일·타입·정적 생성 가능 여부를 검사했으며 실제 인증/DB 연동 검증과는 구분한다. 이 build 산출물을 배포하지 말고 실제 환경변수로 다시 build한다.

```sh
NEXT_PUBLIC_SUPABASE_URL=https://build-check.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=build-check-placeholder npm run build
```

## 2026-09-17 운영 측정과 후속 개선

PR #888 → #889를 통해 `b6c40ffc08948a8d688507297df7e753dd672a29`를 운영에 배포했다.
`app.workdeck.work`의 deployment는 `dpl_8NHL4YkuRfCLKUECFZV1jYGtvrL1`이며 READY를 확인했다.
실제 production 공개 환경변수로 build를 다시 통과했고, 관련 30개 테스트와 lint도 재검증했다.

사용자가 로그인한 브라우저에서 2026-09-10~2026-09-16 기간의 같은 캠페인을 대상으로 각 5회 측정했다.
첫 화면은 KPI 숫자와 캠페인 카드, 상세는 overview 응답·제목·chart SVG를 기다렸다.
전용 Playwright 테스트 파일은 인증 환경변수가 없어 실행하지 않았으며, 로그인된 브라우저에서 동등한 흐름을 실행했다.

| 흐름              | 5회 표시 시간(ms)           | 중앙값 | 최댓값 | 목표 충족     |
| ----------------- | --------------------------- | ------ | ------ | ------------- |
| 첫 화면 문서 진입 | 5782, 2304, 1501, 1649, 465 | 1649   | 5782   | 아니오        |
| 상세 진입         | 7900, 400, 8034, 385, 317   | 400    | 8034   | 아니오        |
| 첫 화면 재진입    | 3261, 474, 4135, 358, 370   | 474    | 4135   | 아니오        |
| 상세 재진입       | 341, 560, 421, 271, 289     | 341    | 560    | 예(이번 표본) |

[원시 측정값](assets/2026-09-17-performance.json)에 Server-Timing과 배포 정보를 보관한다.
문서 재진입이 cold cache를 보장하지 않으며, 이전 배포의 동일 조건 5회 baseline은 없다.
로그인 직후 별도 관측에서 catalog loader 17.49초, date_ranges 3.24초, 목록 API 전체 20.86초가 기록됐다.
KPI auth도 17.53초였으나 connection pool 대기와 인증 처리 시간을 아직 분리하지 못했다.
반복 측정에서 overview loader가 6.79초와 7.67초인 표본이 있어 캐시만으로 완료 처리할 수 없다.
운영 PRISMA_POOL_MAX 환경변수는 미설정으로 소스의 기본값 1이 적용된다. pool은 변경하지 않았다.

후속 변경은 catalog의 전체 DISTINCT ON 정렬을 그룹별 최신 날짜 집계와 LATERAL 이름 조회로 대체한다.
개발 DB 143,621행에서 기존 실행 계획은 10MB external merge 정렬, 실행 564.9ms,
후보는 작은 그룹 정렬과 index-only scan, 실행 381.2ms였다. 조회 결과는 동일했다.
이는 개발 DB의 단일 비교이며 운영 개선율로 해석하지 않는다.
대표 이름 선택 순서를 유지하도록 최종 campaignId/adType 정렬과 workspace 조건을 보존한다.
같은 최신 날짜에 다른 이름이 있으면 기존 구현도 선택이 비결정적이었다.

`campaign-catalog.e2e.test.ts`는 명시적 개발 DB 연결에서 임시 테이블 15만 행으로 실제 SQL을 실행한다.
기존 코드에서는 원본 15만 행 정렬 검사에 실패하고, 변경 후 결과·workspace 격리·정렬 축소 검사가 통과했다.
영구 테이블과 운영 데이터는 수정하지 않는다. 실행 시 `COUPANG_ADS_TEST_DATABASE_URL`을 개발 DB로만 설정한다.

```sh
npx jest --config jest.config.e2e.ts --runInBand campaign-catalog.e2e.test.ts
```

상세는 `overview_latest/ad_types/meta/current/previous/targets/memos` 개별 계측을 추가한다.
동시에 시작한 쿼리의 시간에는 pool 대기도 포함되므로 합산하지 않는다.
후속 배포 후 재측정과 테스트 workspace의 실제 변경 후 갱신 검증은 남아 있다.

### 목록 쿼리 변경만 배포한 결과

PR #890/#891, commit `cb789565`, production `dpl_5psw4jQ99cZmkWeUQnkMcJ4n6DaF`에서 재측정했다.
[5회 원시값](assets/2026-09-17-performance-followup.json): 최초 첫 화면 24.72초,
최초 상세 20.76초였다. 이후 warm 상세 진입 0.26~0.33초, 상세 재진입 0.26~0.91초였지만
목록 SQL 변경만으로 cold 조회 목표는 해결되지 않았다.
catalog loader 19.42초, overview_latest 0.166초, overview_ad_types 13.94초,
뒤에 대기한 나머지 overview 쿼리 약 14.0초였다. 광고유형 전체 이력 조회가 주요 병목으로 좁혀졌다.
같은 기간의 목록과 overview 응답 SHA-256은 변경 전후 동일했다.

### 전체 이력 조회용 인덱스

`AdRecord(workspaceId, campaignId, adType, date)`를 추가한다. 기존 유니크 인덱스는 keyword 등
넓은 컬럼을 포함하고 campaignId 앞에 date가 있어 광고유형 조회에 읽는 범위가 크다.
새 비고유 인덱스는 조회 의미·데이터를 바꾸지 않는다. `CREATE INDEX CONCURRENTLY`로 생성한다.
실패 시 invalid index가 남을 수 있으므로 배포 실패를 무시하거나 migration을 적용 완료로 표시하지 않는다.

개발 DB의 같은 데이터·SQL로 5회 비교한 값:

| 조회    | 적용 전 실행(ms)                         | 적용 후 실행(ms)                       | 접근 block 전 → 후 |
| ------- | ---------------------------------------- | -------------------------------------- | ------------------ |
| catalog | 2198.535, 56.914, 54.700, 55.598, 55.716 | 49.369, 41.498, 40.850, 41.510, 40.829 | 약 5855 → 224      |
| adType  | 61.539, 61.190, 61.281, 61.084, 61.206   | 26.362, 26.465, 26.575, 26.406, 26.621 | 5774 → 151         |

적용 후 두 조회 모두 새 인덱스의 Index Only Scan을 사용했다. 적용 전 첫 표본의 IO 조건이
다르므로 이를 그대로 개선율로 주장하지 않는다. 15만 행 TEMP 테이블 회귀 테스트도 통과했다.

Migration 생성 과정에서 기존 이력의 두 문제가 확인됐다:

1. 자동 shadow DB에 `storage.buckets`가 없어 `20260304231000` migration에서 P3006.
2. 해당 의존성을 구성한 로컬 shadow에서도 `20260606120000`이 `CoupangBackfillStatus` 생성(`20260623000000`)보다 먼저 실행되어 P3006.

기존 migration 파일과 실제 데이터는 수정하지 않았다. PostgreSQL 16 임시 컨테이너의 분리된
개발 DB에 현재 HEAD schema를 `prisma migrate dev --name local_baseline`으로 구성하고,
인덱스 추가 schema로 `prisma migrate dev --name coupang_ads_catalog_index --create-only`를 실행했다.
생성된 인덱스 SQL을 CONCURRENTLY로 바꾼 후 로컬 `migrate dev` 적용을 확인했다.
새 인덱스 migration만 저장소에 복사하고 실제 개발 DB에는 `migrate deploy`로 적용했다.
baseline은 임시 검증용이며 저장소나 기존 개발·운영 DB에 적용하지 않았다.
운영 적용은 기존 Vercel `migrate deploy` 경로로 진행한다. 운영 직접 SQL·db push·reset은 사용하지 않았다.

### 인덱스 운영 적용 결과

PR #892/#893, main `a889238a`, production `dpl_8jy1Aequ1EgcJQq1vGpbJLcmR2Em`에 반영했다.
운영 build 로그에서 2026-09-17 14:40:51 UTC에 migration 적용 성공을 확인했다.
매 회차 로그인 workspace의 광고 tag 캐시만 초기화하고 5회 측정했다. 원본 데이터는 수정하지 않았다.

| 흐름           | 표시 시간 5회(ms)            | 중앙값 | 최댓값 |
| -------------- | ---------------------------- | ------ | ------ |
| 첫 화면        | 5695, 3356, 8022, 2066, 2501 | 3356   | 8022   |
| 상세 진입      | 818, 475, 1954, 376, 404     | 475    | 1954   |
| 첫 화면 재진입 | 1333, 1197, 1190, 1113, 427  | 1190   | 1333   |
| 상세 재진입    | 473, 381, 291, 424, 550      | 424    | 550    |

[원시값과 브라우저 타이밍](assets/2026-09-17-performance-index.json)을 보관한다.
상세는 이번 표본에서 목표 충족, 홈은 목표 미달이다. 최초 API loader 실행과 서비스 cold start는 구분한다.
catalog loader는 주로 0.33~0.47초였으나 3.35초 표본도 있었다. query/pool 대기를 아직 분리하지 못했다.
홈 API가 HTML 응답 완료 후 시작하는 waterfall도 확인됐다. 개발 DB hasData 조회는 0.019~0.982ms로,
운영 SSR 지연을 이 쿼리 탓으로 단정하거나 추가 인덱스를 만들지 않았다.

### 홈 서버 초기 데이터 전달

홈 서버가 `resolveWorkspace`로 API와 같은 권한 검사를 거친 뒤 기존 KPI·목록 query를 병렬 호출한다.
결과는 클라이언트 초기값으로 전달하고, 클라이언트의 기존 API 재검증은 유지한다.
서버 초기 조회 실패 시 기존 클라이언트 조회로 재시도한다. 기간이 바뀌면 이전 수치를 숨기며,
이전 KPI 요청도 abort해 늦은 응답이 새 기간을 덮지 못하게 한다.
사용자 정보를 전역 cache에 저장하거나 공통 인증·pool 설정을 변경하지 않았다.

성능 E2E는 초기 숫자·카드 표시 시간을 먼저 기록하고, 이후 API 응답과의 일치 검사를 별도로 수행한다.
홈 Server-Timing은 초기 SSR 전체 시간이 아니라 백그라운드 API 재검증 시간이다.
이 변경의 회귀 검증은 11개 suite/37개 테스트이며, 권한 거절 시 집계 미실행과 초기값·날짜 전환·props 갱신을 포함한다.

### 2026-09-22 홈 초기 데이터 전달 운영 검증

최신 main 반영 후 12개 suite/38개 테스트, typecheck, lint(오류 0, 기존 경고 63), production build를 통과했다.
PR #901/#902로 main `b2447845`에 통합했고 production `dpl_3iKxNEEfx4DyuEAUVGYUr5Xg6qjm`의 READY와 운영 도메인 연결을 확인했다.

같은 로그인 workspace, 2026-09-15~21 기간으로 배포 직전·직후 각 5회 측정했다.
매 회차 광고 tag cache를 초기화했으나 cache 전파와 platform cold start를 통제한 실험은 아니다.

| 흐름        | 배포 전 중앙값/최댓값(ms) | 배포 후 5회(ms)             | 배포 후 중앙값/최댓값(ms) |
| ----------- | ------------------------- | --------------------------- | ------------------------- |
| 홈 최초     | 1487 / 2627               | 4824, 1579, 1464, 444, 1883 | 1579 / 4824               |
| 상세 최초   | 351 / 526                 | 1454, 514, 396, 412, 334    | 412 / 1454                |
| 홈 재진입   | 838 / 1336                | 1315, 322, 1329, 328, 844   | 844 / 1329                |
| 상세 재진입 | 359 / 523                 | 936, 348, 399, 818, 280     | 399 / 936                 |

[전체 원시값](assets/2026-09-22-performance-ssr.json)을 보관한다. 동일 날짜 비교에서 중앙값 개선은 입증되지 않았다.
홈은 최초 3초·재진입 1초 목표를 넘는 표본이 있어 미완료이며, 상세는 이번 표본에서 목표를 충족했다.
배포 직후의 4824ms를 제외하지 않았다. 이 값의 원인을 platform cold start라고 단정하지 않는다.

모든 측정 API는 200이고 표시 KPI가 API 값과 일치했다. 브라우저에서 KPI·목록 API를 차단해도
서버 초기 KPI와 캠페인 카드 4개가 표시됐다. 차단 해제 후 날짜 변경 시 새 기간의 KPI·카드 갱신도 확인했다.
상세 초기 요청은 목록과 overview만 발생했고 비활성 탭 API는 없었다.

남은 검증은 테스트 workspace의 실제 변경 후 현재·재진입 화면 갱신이다. 테스트 workspace가 지정되지 않아
운영 데이터를 변경하지 않았다. 홈 목표 초과 원인을 좁히려면 SSR/auth/DB 연결 대기 및 브라우저 표시 구간을
분리해 관측해야 한다. 백그라운드 API Server-Timing을 초기 SSR 시간으로 해석하거나 pool을 근거 없이 늘리지 않는다.
