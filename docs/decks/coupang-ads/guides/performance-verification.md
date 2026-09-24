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

### 실제 변경 후 갱신 검증과 SSR 구간 진단

개발 Supabase Auth에 메일 발송 없이 일회용 계정을 만들고, 분리된 개발 DB에 합성 광고 1행과
일회용 workspace/space를 생성했다. 로컬 Next.js에서 실제 로그인 후 캠페인 이름을 변경하고
현재 상세·사이드바·홈 재진입·상세 재진입의 갱신 및 원래 이름 복원을 연속 두 번 확인했다.
같은 흐름을 `e2e/coupang-ads-campaign-detail-perf.spec.ts`에 추가했고, 새 일회용 workspace로
Playwright 1개 테스트를 실행해 통과했다(7.1초). 일회용 계정·workspace·space와 광고 데이터는 삭제했다.
이 테스트는 `E2E_COUPANG_ADS_MUTATION=1`과 기존 E2E 로그인 변수를 명시한 삭제 가능한 테스트 workspace에서만 실행한다.
운영 데이터를 변경하지 않았으며, 업로드 파일 처리의 실제 UI 검증과는 구분한다.

홈 재진입 지연은 prefetch 차단 상태에서도 1.312초로 재현되어 prefetch만이 원인은 아니었다.
PR #908/#909의 SSR 계측에서 느린 요청의 auth는 930.7~1016.3ms, KPI는 35.3~40.8ms,
목록은 208.8~223.8ms였다. 이에 PR #910/#911에서 auth를 사용자·멤버십·deck·workspace 조회로 나누었다.
로그는 고정 구간명과 시간만 기록하며 개인정보·광고 결과·오류 메시지는 포함하지 않는다.

인증 세부 계측에서는 느린 표본의 `auth_user`가 185.9~274.8ms, `auth_membership`이 717.3~749.7ms였다.
`auth_deck`은 13.8~17.8ms, `auth_workspace`는 5.5~14.8ms였다. 멤버십 구간에는 DB 연결·대기가 포함될 수 있으며 SQL 실행 시간으로 단정하지 않는다.
레이아웃과 페이지가 반복 호출하는 `getUser`·`resolveSpaceContext`에 React `cache`를 적용해 한 서버 렌더링 요청에서만 공유한다.
다음 요청은 다시 검증하며 Route Handler에서는 React 렌더링 캐시를 재사용하지 않는다.
실제 RSC 렌더러 테스트는 서로 다른 사용자·익명·동일 사용자 재요청 4회를 검증한다.
사용자 조회가 변경 전 20회로 실패하고 변경 후 4회로 통과했으며 인증된 요청의 멤버십 조회는 각각 1회였다.
레이아웃이 먼저 시작한 공유 조회는 페이지의 AsyncLocalStorage 로그에 세부 구간이 없을 수 있으므로 이를 DB 조회 0ms로 해석하지 않는다.
참고: [React cache의 요청별 범위](https://react.dev/reference/react/cache).

### 요청 내 인증 중복 제거 배포 후 측정

PR #912/#913, main `e5459ccc`, production `dpl_H5uEin1GqDPeNJRxKpWzEi8rUzLR`의 운영 도메인 연결을 확인했다.
[5회 원시값](assets/2026-09-22-performance-auth.json)은 배포 직후 표본도 포함한다.

| 흐름        | 5회(ms)                    | 중앙값 | 최댓값 |
| ----------- | -------------------------- | ------ | ------ |
| 홈 최초     | 3956, 1574, 720, 2463, 994 | 1574   | 3956   |
| 홈 재진입   | 322, 828, 824, 1320, 1314  | 828    | 1320   |
| 상세 최초   | 936, 401, 497, 2070, 626   | 626    | 2070   |
| 상세 재진입 | 650, 406, 411, 383, 299    | 406    | 650    |

표시 KPI와 API 응답은 모두 일치했고 비로그인 브라우저는 로그인으로 이동, KPI API는 401이었다.
홈 목표 초과가 남았다. 느린 SSR의 멤버십 구간은 609.7~755.2ms였으며, 신규 연결 수립과
그 외 대기를 구분하기 위해 `db_connect`를 추가 계측한다. 연결 수/SSL/URL/idle 설정은 유지한다.
`db_connect`는 성공한 새 연결만 나타내며 pool 대기·실패는 포함하지 않는다. 기록이 없다고 연결이 없었다고 단정하지 않는다.
`membership_loop_active/idle`은 해당 구간의 프로세스 이벤트 루프 지표이며 동시 요청 작업도 포함할 수 있다.

### 첫 조회 초기화 비용과 작은 query compiler 검증

PR #914/#915 배포 후 느린 SSR 표본은 `auth_membership=943.4ms`, `db_connect=60.9ms`,
`membership_loop_active=867.3ms`, `membership_loop_idle=76.0ms`였다. 연결 수립만으로 전체 지연을
설명할 수 없다. 이벤트 루프 활성 시간은 CPU 사용 시간이나 Prisma만의 실행 시간이 아니므로,
애플리케이션 초기화 비용을 추가 후보로 다룬다.

Prisma 7.4.1에서 지원하는 generator의 `compilerBuild = "small"`을 비교한다.
[공식 설명](https://www.prisma.io/changelog/2026-01-21)에 따르면 작은 번들과 쿼리 실행 성능의 trade-off가 있다.
동일 개발 DB의 존재하지 않는 멤버십을 별도 새 Node.js process에서 조회한 3회 결과는
기본 compiler 최초 311/178/162ms, small 최초 148/151/139ms였다. 후속 조회는 양쪽 모두 13~17ms였다.
로컬 소표본이므로 운영 개선을 입증한 것으로 해석하지 않는다.
DB 모델·마이그레이션·연결 수·SSL 설정을 변경하지 않고 생성 client의 compiler만 바꾼다.
관련 41개 테스트와 실제 합성 workspace 이름 변경·현재/재진입 갱신 E2E가 통과했다.

### small compiler 운영 배포 후 결과

PR #916/#917, main `a3a0d863`, deployment `dpl_EnDzg7uhCaM8XhkRc56h2dCb9ni8`의 READY 및
`app.workdeck.work` 연결을 확인했다. [5회 원시값](assets/2026-09-22-performance-small.json)을 보관한다.

| 흐름        | 5회(ms)                   | 중앙값 | 최댓값 |
| ----------- | ------------------------- | ------ | ------ |
| 홈 최초     | 4850, 1502, 441, 437, 483 | 483    | 4850   |
| 홈 재진입   | 1323, 217, 825, 1330, 326 | 825    | 1330   |
| 상세 최초   | 956, 451, 405, 387, 384   | 405    | 956    |
| 상세 재진입 | 689, 242, 262, 320, 385   | 320    | 689    |

모든 API는 200, 표시 KPI는 응답과 일치했다. 관련 41개 테스트, 실제 변경 후 갱신 E2E,
typecheck, lint(0 errors/기존 63 warnings), production build가 통과했다. 생성 client의 inline schema에는
기존 배포된 AdRecord index도 동기화됐다. 새 DB 모델·DDL 변경은 없다.

홈 중앙값은 이전 표본보다 낮았으나 최초 최댓값은 오히려 높았다. 소표본·배포별 실행 환경 차이가 있으므로
small compiler의 운영 개선율을 단정하지 않는다. 이 배포에서도 느린 SSR은 `auth_membership=833.7ms`,
`db_connect=67.9ms`, `membership_loop_active=760.5ms`, `total=2095.1ms`로 관측됐다.
다른 업무의 모든 복잡한 쿼리 성능 보존을 확인한 것은 아니다.

별도 홈 재진입 5회에서 MutationObserver로 숫자·카드 DOM을 관찰했다. 기존 locator 대기 측정은
1821/319/210/211/214ms, DOM 표시 조건 충족은 1440/283/209/187/196ms였다. locator의 polling 지연이
일부 포함되지만 DOM 기준에도 1초 초과가 남았다. 이 보조 측정은 브라우저 paint 시각이 아니며,
최초 5회의 느린 표본을 삭제하거나 대체하지 않는다.

상세는 이번 표본에서 최초 3초·재진입 1초 목표를 충족했다. **홈 목표는 미완료**다.
현재 남은 진단 범위는 새 실행 환경의 초기화, SSR 밖 레이아웃·인증 대기, RSC 전달과 표시 구간이다.
멤버십 전체 시간을 SQL 시간 또는 CPU 사용 시간으로 해석하거나, 근거 없이 DB pool/유료 자원을 늘리지 않는다.

### 홈 링크의 데이터 prefetch와 변경 후 무효화

추가 CDP 관찰에서 느린 홈 재진입은 응답 헤더 252ms, 핵심 RSC 조각 수신 1079ms,
DOM 조건 충족 1092ms였다. 다른 느린 표본도 데이터 수신 후 DOM 반영은 약 10ms였고,
서버 응답에서 먼저 대기가 발생했다. 신규 실행 환경의 인증·Prisma 초기화 지연이 남아 있으므로
클릭 후 그 대기를 반복하지 않도록 쿠팡 광고 홈 링크에만 Next.js full prefetch를 적용한다.
My Deck의 진입 링크와 사이드바의 홈 링크가 대상이며, 직접 URL 접속의 초기화 비용까지 제거하는 변경은 아니다.

기존 서버 데이터 cache는 1시간이며, [Next.js full prefetch](https://nextjs.org/docs/app/guides/prefetching)는
클라이언트 Router Cache에서 서버 페이지 결과를 재사용한다. 권한 검사는 서버 prefetch 요청 때 실행되며,
캐시로 이동하는 클릭마다 다시 실행된다고 주장하지 않는다. 쓰기 API의 권한 검사는 유지한다.
이름·삭제·업로드·목표 예산/ROAS 변경 성공 알림에서 `router.refresh()`를 호출해 이전 홈 결과를 버린다.
목표 저장/삭제 실패 시에는 변경 알림을 보내지 않는다.

실제 production-mode 로컬 서버와 분리된 개발 합성 workspace에서
My Deck의 홈 `initialData` prefetch 완료 → 홈 → 상세 → 이름 변경 → KPI·목록 API 차단 →
홈의 새 이름 및 상세 재진입을 확인했다. API가 이전 값을 나중에 고치는 방식으로 통과하지 않는다.
실행 시 `E2E_COUPANG_ADS_MUTATION=1 E2E_COUPANG_ADS_PREFETCH=1`을 명시한다.
추가 UI 회귀를 포함한 45 tests, lint(0 errors/기존 63 warnings), production-mode build를 통과했다.

### 홈 full prefetch 운영 결과

PR #920/#921, main `bb53cf7e`, production `dpl_33nP7awVPXTSKUwu8cK6E8YEQ21z`의 READY 및
운영 도메인 연결을 확인했다. [전후 원시값 및 RSC 관찰](assets/2026-09-22-performance-prefetch.json)을 보관한다.

| 흐름        | 배포 전 중앙값/최대(ms) | 배포 후 5회(ms)            | 배포 후 중앙값/최대(ms) |
| ----------- | ----------------------- | -------------------------- | ----------------------- |
| 홈 직접 URL | 1335 / 1849             | 4417, 1302, 615, 1270, 425 | 1270 / 4417             |
| 홈 재진입   | 322 / 1325              | 834, 71, 61, 319, 58       | 71 / 834                |
| 상세 최초   | 357 / 637               | 2344, 561, 363, 350, 367   | 367 / 2344              |
| 상세 재진입 | 518 / 644               | 326, 360, 365, 284, 316    | 326 / 365               |

각 cycle 전에 기존 workspace tag를 무효화했고, 모든 API는 200이며 KPI는 응답과 일치했다.
새 비로그인 context는 로그인으로 이동했고 KPI API는 401이었다.
홈 재진입과 상세는 이번 5회 표본에서 목표를 충족했다. **직접 URL 최초 표본 4417ms는 미달이며 제외하지 않았다.**
배포 직후라는 조건을 기록하되 이를 platform cold start만의 영향으로 단정하지 않는다.

별도 My Deck 진입 측정은 링크 표시 후 1초 동안 머문 다음 클릭부터 데이터 카드 표시까지 측정했다.
1초는 전후 동일 조건이고 측정 시간에 포함되지 않는다. prefetch 완료 자체를 기다리지는 않는다.
배포 전 970/1010/1204/413/333ms(중앙값970, 최대1204), 배포 후 129/945/72/70/343ms
(중앙값129, 최대945)였다. 이 흐름은 직접 URL 접속과 구분한다.
일반 링크 진입의 관측 개선이 직접 URL 초기화 비용 제거를 의미하지 않는다.

남은 엄격한 완료 조건은 배포 직후를 포함한 직접 URL 진입 3초 이내다.
후속 진단에서는 Proxy의 세션 갱신과 페이지의 인증 조회, 함수 초기화 시간을 분리해야 한다.
권한 확인을 생략하거나 검증 없이 인증 방법·유료 실행 자원을 바꾸지 않는다.

### 2026-09-23 직접 접속: 캠페인 목록 전체 이력 읽기 제거

직접 접속의 MutationObserver 측정은 최초 숫자·카드 DOM 조건 충족 3568.7ms,
다음 두 animation frame 후 3572.5ms, 기존 load 대기 포함 3720ms였다.
측정 도구의 load 대기만으로 초과를 설명할 수 없다. 같은 실행의 서버 로그에서
느린 SSR은 `catalog_loader=790.2ms`, `auth_membership=696.0ms`, `total=1936.2ms`였다.
프레임 콜백은 실제 paint 완료를 보장하지 않으며 전체 요청과 SSR 로그의 일대일 대응도 단정하지 않는다.

기존 catalog SQL은 `GROUP BY campaignId, adType` 때문에 전체 광고 이력을 읽었다.
기존 `(workspaceId,campaignId,adType,date)` index에서 다음 그룹 키를 찾아 건너뛰는
recursive CTE와 그룹별 최신 행 조회로 변경했다. [PostgreSQL loose indexscan 설명](https://wiki.postgresql.org/wiki/Loose_indexscan)을 따른다.
DB schema·index·연결 수·권한·cache TTL 변경은 없다.

개발 DB 연결 전용 임시 테이블 15만 행, 6개 그룹에서 전후 결과가 같았다.
[실행 계획 5회 원시값](assets/2026-09-23-catalog-seek.json)의 기존 실행 시간은 78.275~78.798ms,
변경 후는 0.439~0.499ms였다. scan 노드 출력 행 합계(`Actual Rows × Actual Loops`, JSON의 `scannedRows`)는
150006→13, root plan의 local hit/read buffer 합계는 1127→51이었다.
출력 행 수는 index 내부 탐색량 전체를 의미하지 않는다. 이 비교는 소수 그룹에 많은 이력이 있는 합성 데이터 기준이며,
그룹 수가 원본 행 수에 가까우면 반복 index seek가 불리할 수 있다.

실제 PostgreSQL 회귀 테스트는 기존 코드에서 150006행으로 실패하고 변경 후 통과했다.
최신 이름·광고유형 순서·workspace 격리·빈 목록을 검증했다. 같은 최신 날짜에 이름이 여러 개면
선택이 비결정적인 기존 동작은 유지한다. 관련 45 tests와 실제 DB 2 tests, lint(0 errors/기존 63 warnings),
production build가 통과했고 리뷰에서 필수 수정 사항은 없었다. 임시 테이블은 연결 종료로 삭제됐다.

### 인덱스 그룹 탐색 운영 배포 결과

PR #924/#925, main `684c63f2`, production `dpl_HxmmiSKbCSCbk7bfubhre8m1XEmN`의 READY와
운영 도메인 연결을 확인했다. [5회 전체 원시값](assets/2026-09-23-performance-seek.json)을 보관한다.

| 흐름        | 5회(ms)                    | 중앙값 | 최댓값 |
| ----------- | -------------------------- | ------ | ------ |
| 홈 직접 URL | 4181, 1208, 1406, 334, 331 | 1208   | 4181   |
| 홈 재진입   | 826, 60, 57, 323, 212      | 212    | 826    |
| 상세 최초   | 928, 517, 375, 328, 338    | 375    | 928    |
| 상세 재진입 | 1990, 462, 290, 286, 323   | 323    | 1990   |

모든 측정 API는 200이고 KPI는 화면과 일치했다. 비로그인 context는 로그인 이동, KPI API는 401이었다.
배포 직후 첫 직접 URL 표본의 DOM 조건 충족도 4056.6ms로, load 대기만이 초과 원인은 아니다.
기존 직접 URL 진단 5회는 cache reset 없이 실행했으므로 이 결과와 제어된 전후 비교로 취급하지 않는다.

느린 SSR 로그의 catalog loader는 174.6ms로 관측됐고, 이전 느린 표본의 790.2ms보다 낮았다.
이는 서로 다른 요청·배포 표본이라 순수 SQL 실행 개선율로 해석하지 않는다.
같은 느린 SSR의 `auth_membership=820.0ms`, `date_ranges=473.1ms`, `total=2010.1ms`였다.
목록의 전체 이력 스캔은 제거했지만 인증/초기화와 날짜 범위 집계에 대기가 남는다.
상세 재진입 1990ms 표본도 `auth_membership=545.4ms`, `db_connect=39.0ms`, API total=711.0ms였다.
SQL 변경이 상세 지연을 유발했다고 단정할 수 없으며, 초과 표본을 제외하지 않는다.

최신 표본의 미완료 항목은 직접 URL 3초 목표와 상세 재진입 1초 목표다.
후속 후보는 날짜 범위의 전체 이력 `GROUP BY`를 기존 인덱스의 최소/최대 탐색으로 대체하는 것,
Proxy·함수 초기화·페이지 인증 대기를 분리하는 것이다. 현재 코드 변경·배포·회귀 검증은 완료했으나
전체 속도 목표 완료로 표시하지 않는다.

### 날짜 범위 집계의 전체 이력 읽기 제거

`queryCampaigns`의 날짜 범위 `GROUP BY`를 catalog에 있는 캠페인별 최소·최대 날짜
index seek로 교체했다. 기존 `(workspaceId,campaignId,date)` index를 사용하며
TTL·workspace tag 무효화·응답 날짜 형식은 유지한다. 날짜 cache key에는 정렬한 캠페인 ID 목록을
포함해 업로드와 겹친 옛 catalog 요청이 신규 캠페인의 날짜를 가리지 않게 한다.
해당 경쟁 상태의 회귀 테스트는 수정 전 신규 날짜 null로 실패하고 수정 후 통과했다.
빈 catalog는 SQL을 실행하지 않는다.

[개발 DB 임시 테이블 15만 행/3개 캠페인 비교](assets/2026-09-23-date-bounds.json)에서
결과 3행이 같았고, 교차 실행 5회의 기존 실행 시간은 63.270~64.420ms, 변경 후는
0.208~0.248ms였다. root plan local hit/read buffer 합계는 811→24였다.
이는 합성 데이터 SQL 실행 비교이며 운영 화면 전체 개선율을 의미하지 않는다.

실제 PostgreSQL 회귀 테스트는 날짜·workspace 격리·빈 목록과 buffer 상한을 확인한다.
기존 쿼리는 1103 buffers로 실패했고 변경 후 통과했다. 이 테스트의 임시 테이블은
비교 벤치마크와 컬럼 구성이 달라 buffer 수를 동일 기준으로 혼합하지 않는다.
실제 Prisma client와 adapter의 배열 파라미터 바인딩도 개발 DB에서 확인했다.

페이지 밖의 대기를 구분하려고 layout의 `requireDeckAccess`를 `layout_guard`로 기록하고,
정상 쿠팡 덱 응답의 `Server-Timing`에 Proxy `updateSession`의 `proxy_session`을 추가했다.
세션·사용자 정보는 기록하지 않으며 인증 동작은 동일하다. layout/page 시간은 겹칠 수
있어 합산하지 않는다. Proxy 계측에는 모듈 초기화가 포함되지 않고 별도 redirect 응답에는
헤더가 붙지 않는다. 운영 배포 후 첫 접속 표본을 포함해 재측정한다.

관련 46 tests, 실제 PostgreSQL 3 tests, lint(0 errors/기존 63 warnings), production build가
통과했다. 리뷰에서 발견한 cache 입력 누락을 수정했고 재검토에서 추가 필수 수정은 없었다.

### 날짜 범위 최적화 운영 배포 결과

PR #929/#930, main `01cef079`, production `dpl_8gVGGo69J8tdEAKdfR9vgaFKRYxh`의 READY와
운영 도메인 연결을 확인했다. [5회 원시값](assets/2026-09-23-performance-date-bounds.json)을 보관한다.
각 cycle 전에 workspace data cache tag를 삭제했으며 플랫폼 cold start를 보장하지는 않는다.

| 흐름        | 5회(ms)                    | 중앙값 | 최댓값 |
| ----------- | -------------------------- | ------ | ------ |
| 홈 직접 URL | 3628, 1795, 1619, 329, 278 | 1619   | 3628   |
| 홈 재진입   | 836, 66, 1333, 221, 118    | 221    | 1333   |
| 상세 최초   | 1703, 470, 290, 379, 352   | 379    | 1703   |
| 상세 재진입 | 334, 500, 314, 283, 278    | 314    | 500    |

모든 측정 API는 200이며 KPI가 화면과 일치했다. 비로그인 context는 로그인 이동, KPI API는 401이었다.
직접 URL 첫 표본의 DOM 조건 충족은 3149.7ms, frame callback은 3160.5ms, responseEnd는
2833.2ms였다. 3628ms는 기존 load 대기 포함 방식의 값이며 DOM 측정도 3초를 초과했다.
나머지 직접 URL DOM 표본은 1747.0, 1576.8, 290.9, 240.9ms였다.

Proxy `updateSession`은 첫 표본 325.7ms, 나머지 29.8~36.9ms였다. API 날짜 loader는
3.6~5.6ms였다. 서버 로그에서 `layout_guard=1323.7/1046.2ms`, 다른 페이지 로그에서
`auth_membership=774.6ms`, `db_connect=67.4ms`, page total=936.2ms를 확인했다.
membership 시간에는 Prisma 초기화·대기·쿼리가 함께 포함된다. layout과 page의 겹치는 시간은
합산하지 않으며 요청별 연계 식별자가 없어 화면 표본과 일대일 대응시키지 않는다.

최신 5회에서 상세 최초/재진입 목표는 충족했다. 홈 직접 URL 3초와 홈 재진입 1초 목표는
미완료다. 날짜 쿼리 최적화와 별도로 인증·레이아웃/서버 초기화와 RSC 응답 대기를 분리해야 한다.
추가 네트워크 추적을 시도했지만 Playwright MCP가 `Transport closed`를 반환했고 재시도도
같아 실행하지 못했다. 위 5회 측정과 비로그인 검증은 연결 종료 전에 완료된 결과다.

### CDP 연결 복구 후 진단

Playwright MCP 연결 대신 기존 Chrome의 CDP에 연결해 로그인 확인 후 측정을 재개했다.
브라우저 세션이 달라 이전 측정과 엄격한 전후 비교로 취급하지 않는다.
[5회 cache hit/5회 cache reset 원시값과 요청 타이밍](assets/2026-09-23-cdp-diagnostic.json)을 보관한다.
cache reset 조건의 홈 직접 URL은 1836/1596/1324/405/615ms, 홈 재진입은
1338/118/616/1339/316ms였다. 상세 최초는 366~830ms, 재진입은 298~623ms였다.
모든 KPI 비교가 일치했다. 정상 세션이라고 재진입 목표 초과가 사라지지는 않았다.

느린 홈 재진입의 RSC 요청 두 개는 Proxy 34.3/24.4ms, 요청 시작부터 responseEnd까지
948.730/939.563ms였다. 서버 데이터 전송이 계속되는 구간이 확인됐지만 이것만으로
정확한 서버 하위 원인을 단정하지 않는다. 별도로 조회한 7c0369af 배포 SSR 로그의 membership 703.2/905.0ms,
page total 940.8/1158.7ms도 관측했다. 요청 연계 식별자가 없어 화면 표본과 일대일 대응은 아니다.
또한 CDP 측정 동안 운영 도메인 배포를 고정 검증하지 않았고 다른 main 배포가 병행됐다.
따라서 이 값들은 단일 배포의 완료 판정이나 전후 비교에 사용하지 않는다.

개발 DB 새 프로세스의 멤버십 ORM/raw SQL 비교에서 첫 조회 차이는 대부분 수십 ms였다.
공통 인증을 SQL로 바꾸는 것만으로 운영 지연이 사라진다는 근거는 부족해 적용하지 않았다.

후속 계측은 `prisma_client`(동기 client 생성), `db_query`(Prisma query 이벤트 시간 합계),
`layout_user/context/entitlement`로 나눈다. client 생성에는 첫 query compiler 초기화 전체가
포함되지 않는다. 실제 generated Prisma client/adapter에서 query 이벤트의 ALS 전달을 확인했다.
`db_query`에는 pool/연결/네트워크 대기가 포함될 수 있고 다른 구간과 중첩된다. SQL·파라미터는
출력하지 않는다. 이 변경은 원인 분리를 위한 계측이며 속도 개선 완료로 취급하지 않는다.

### 초기화 세부 계측 배포와 Proxy 후속

PR #939/#940(main `73952ecd`), production `dpl_2u9pk2XECEyceRieiJPXz2Zm2ELE` READY 확인.
71 tests·lint(0 errors/기존63 warnings)·build·typecheck·리뷰를 통과했다.
[고정 배포 URL과 운영 도메인 각 5회](assets/2026-09-23-performance-init.json)를 보관한다.
고정 URL은 첫 화면 최대2754ms, 홈 재진입140ms, 상세 최초1076ms, 재진입572ms였으나,
같은 배포 운영 도메인에서는 홈 재진입1402ms가 다시 관측됐다. 목표 전체 완료로 처리하지 않는다.
운영 도메인 측정 전후 alias ID가 같았음을 확인했다.

한 API 요청은 `prisma_client=205.0ms`, `auth_membership=605.9ms`,
요청 전체 `db_query=114.3ms`, `db_connect=39.0ms`였다. 동기 client 생성만도 비용이 있었으며
멤버십 구간 전체를 SQL 시간으로 볼 수 없다. query 합계와 connect 시간은 중첩될 수 있다.
layout에서는 `layout_context=562.0/616.4ms`, `layout_entitlement=44.7/179.1ms`도 관측했다.
서로 다른 요청의 구간을 합산하지 않는다. 개발 비교에서 Sentry 자동 계측 활성화는 큰 차이가 없어
운영 모니터링 설정은 유지했다.

운영 도메인 5번째 직접 접속의 Proxy 세션 갱신은799.8ms였다. 실제 세션을 메모리에서만 사용한
조회 비교에서 getUser는85.8/118.3/506.0/97.9/110.7ms, getClaims는96.9/2.7/0.7/0.6/1.4ms였다.
이는 로컬 네트워크 비교이며 운영 개선율을 보장하지 않는다.

후속 변경은 Proxy의 쿠팡 홈 exact 및 `/d/coupang-ads/campaigns/[^/]+` exact만
`getClaims`로 서명·만료를 검증하고 갱신한다. 다른 경로는 getUser를 유지한다.
서버의 getUser·workspace·deck·구독 검사는 그대로다. [Supabase 공식 설명](https://supabase.com/docs/guides/auth/server-side/advanced-guide)에 따르면
getClaims만으로 서버 세션 폐기를 확인할 수 없으므로 이 최종 서버 검사를 대체하지 않는다.
[공식 Proxy 예제](https://github.com/supabase/supabase/blob/master/examples/auth/nextjs/lib/supabase/proxy.ts)에 맞춰
갱신 쿠키를 downstream 요청과 브라우저 응답에 전달하며 redirect/rewrite에서도 보존한다.

17개 인증 경계 테스트의 red/green을 확인했다. 실제 개발용 일회용 Auth 계정으로 저장된 세션의
만료 시각을 과거로 설정해 refresh를 유도하고, request override·response cookie·downstream
getUser를 검증했다. 변조 JWT는 거부됐다. 계정 삭제 후 서명상 유효한 JWT는 getClaims를 통과해도
getUser에서 차단됐다. 테스트 계정은 삭제했다. 실제 JWT의 exp를 서명 없이 바꾼 시험은 아니다.
리뷰에서 발견한 admin rewrite의 request cookie 전달 누락도 회귀 테스트와 함께 수정했다.

Proxy 후속 관련105 tests, lint(0 errors/기존63 warnings), production build가 통과했다.
리뷰 재확인에서 추가 필수 수정은 없었다.

### Proxy 인증 개선 운영 결과 (2026-09-23)

PR #941/#942, main `be8a87c9`, production `dpl_GcUBaPyaQ2jVcS8ZnSK3DGeytcdH` READY.
[전체 10회 원시값과 인증 확인](assets/2026-09-23-performance-claims.json)을 보관한다.
운영 도메인 측정 전후 alias는 모두 이 배포였다. 매 회 workspace cache tag를 초기화했으며,
플랫폼 cold start를 강제한 것은 아니다. 기간은 2026-09-16~22다.

| 흐름         | 운영 도메인 5회(ms)           | 중앙값 | 최댓값 |
| ------------ | ----------------------------- | -----: | -----: |
| 홈 직접 진입 | 878 / 2840 / 1577 / 396 / 441 |    878 |   2840 |
| 홈 재진입    | 141 / 112 / 1416 / 1425 / 864 |    864 |   1425 |
| 상세 진입    | 593 / 2729 / 647 / 482 / 466  |    593 |   2729 |
| 상세 재진입  | 384 / 595 / 415 / 384 / 446   |    415 |    595 |

고정 배포 URL의 홈 직접 진입은3221/1338/381/392/1532ms, 재진입829/61/87/856/67ms였다.
상세 진입1289/407/368/358/342ms, 재진입556/300/349/322/346ms였다.
첫3221ms는 `page.goto`의 load 대기를 포함한다. 같은 요청 KPI·캠페인 카드의 DOM 표시 시점은
2727.4ms였다. 두 지표를 혼용하지 않으며, 이전 load 기반 기준의 초과 표본도 유지한다.
실제 paint 시점을 측정한 것은 아니다. 모든 측정의 API는200이고 홈 KPI 비교는 일치했다.

고정 URL 첫 Proxy는318.5ms, 이후1.8~3.9ms였다. 운영 도메인 직접 진입은2.8~4.8ms였다.
홈 재진입 초과 두 회의 RSC는 Proxy2.8/4.6ms, responseEnd892.965/910.079ms였다.
Proxy 중복 네트워크 조회는 줄었지만 홈 재진입1초 목표는 미완료다.
SSR 로그에는 `prisma_client=171.9/200.1ms`, `auth_membership=565.8/620.3ms`,
`layout_context=513.0/572.1/633.7ms`도 남았다. 화면 요청과 일대일 연결되지 않으므로
이 수치를 해당 초과 표본의 확정 원인으로 단정하지 않는다. 다음 조사는 서버 초기화 및
레이아웃 구간과 브라우저 RSC 요청을 연결하는 데 집중한다.

비로그인 브라우저에서 쿠팡 전용 `/d/coupang-ads/login` 화면을 확인했고 API는401이었다.
초기 검증 스크립트의 `/login` exact 기대값은 전용 로그인 경로를 고려하지 못해 실패했다.
후속 브라우저 이동 두 번은30초/20초 timeout이 발생했고 캐시 초기화 CLI도 지연됐다.
이것들을 성공 표본으로 처리하지 않았다. 별도 HTTP 검증에서는307→전용 로그인200(본문 확인),
API401을 재확인했다. 따라서 이 시점 브라우저 timeout의 원인은 확정하지 않는다.

관련105 tests·lint·build·typecheck·리뷰와 실제 DEV 세션 refresh/폐기 검증은 통과했다.
테스트 계정은 삭제했다. 전체 성능 목표 완료로 처리하지 않는다.

### 2026-09-24 요청 단위 추적 및 초기화 비교

[원시값과 요청별 연결 로그](assets/2026-09-24-performance-followup.json)를 기록했다.
이번 작업은 진단과 E2E 측정 보완이며 앱 속도 개선 코드를 새로 배포하지 않았다.
운영 도메인 측정 전후 배포는 `dpl_2YXDbM24eBTbJuQnfoScHCtApyng`로 같았다.
고정 비교 배포는 기존 인증 개선 commit `be8a87c9`의 `dpl_GcUBaPyaQ2jVcS8ZnSK3DGeytcdH`다.

- 고정 배포 첫 홈은4164ms(load 대기 포함), 데이터 DOM3432.5ms였다. 이후 홈은295~1082ms.
  같은5회에서 상세 재진입1936ms도 관측해 이전 상세1초 판정을 안정적 보장으로 취급하지 않는다.
- 응답의 `x-vercel-id` 마지막 구간과 Vercel 로그의 `id`를 연결할 수 있음을 확인했다.
  첫 홈 request `t25fj-1790226099378-425f6236c77d`는 responseEnd3383.093ms,
  layout_guard1205.2ms(layout_user153.7/context845.2/entitlement206.1)였다.
  나머지 시간을 전부 cold start라고 단정하지 않는다. 플랫폼 시작·렌더링·전송 등 미계측 구간이 남는다.
- 홈 RSC request `g4hh2-1790226106124-c1d3a4f452da`는 responseEnd819.263ms와
  SSR total726.1ms가 연결됐다. auth_membership586.4ms 안에 prisma_client189.8ms가 포함됐다.
  다른 RSC `g4hh2-1790226112848-015ec90965ec`도 responseEnd866.55ms,
  total792.5ms, membership602.1ms, prisma_client194.3ms였다.
  광고 데이터 집계만이 남은 지연의 원인은 아니다. warm RSC는 total105.7~114.5ms였다.
- 상세 재진입1936ms의 overview API는 responseEnd1772.516ms, 내부 total772.3ms,
  auth_membership625.7ms, prisma_client192.5ms, data31.5ms였다.
  내부 total과 브라우저 시간 차이를 인증/SQL 시간으로 합산하지 않는다.

첫 홈에서 미방문 메뉴·캠페인 prefetch34개를 관측해, 불필요한 prefetch를 브라우저에서 차단하는
A/B 실험을5쌍 수행했다. 양쪽 모두 request interception을 사용했고 실제 앱 코드는 바꾸지 않았다.
차단군에서도 상세 진입1630ms가 발생했으며 홈 재진입 중앙값은 차단 전74ms/후80ms였다.
일관된 지연 개선 근거가 없어 prefetch 정책을 변경하지 않았다. 차단 실험의 요청 수는 시도 수이며
abort된 요청도 포함한다. cold start를 통제한 실험은 아니다.

Prisma7.4.1과7.10.0을 동일 schema/small compiler, pool1, 새 로컬 프로세스, DEV 읽기 쿼리로
각5회 교차 비교했다. 초기 조회 중앙값158.5/155.4ms, client 생성18.9/18.3ms였다.
첫7.4.1 표본400.3ms에는 연결183.3ms가 포함됐으며 제외하지 않았다. import/transpile 시간은
측정 시작 전이다. 운영 CPU 환경과 다르며 유의미한 개선을 입증하지 못해 의존성은 유지했다.
임시 경로에만 client를 생성했고 DB schema·운영 데이터·프로젝트 lockfile은 변경하지 않았다.

E2E 첫 `page.goto`는 `waitUntil: 'commit'`으로 바꿔 이미지 등 전체 load가 데이터 표시 시간을
부풀리지 않게 했다. Chromium 합성 페이지에서 이미지 응답을 보류한 상태로 데이터26ms,
당시 loadEventEnd0, 이미지 해제 후 load 완료를 확인했다. 이 변경으로 과거 표본을 재분류하지 않는다.
기존 samples attachment 배열은 유지하고 별도 `coupang-ads-performance-requests.json`에
완료/실패 요청의 path·timing·Server-Timing·x-vercel-id만 남긴다. 쿠키·본문·query는 제외한다.
수집 실패를 즉시 처리해 원래 테스트 오류와 attachment 저장을 가리지 않으며 실패 수를 판정에 포함한다.

수정한 실제 측정 callback을 로그인된 CDP 세션으로 실행했다(비밀번호 로그인과 일반 Playwright
runner 제외). 5회 모두 API/숫자 검사와 임계값을 통과했고 요청 수집 실패0건이었다.

| 흐름         | 5회(ms, 반올림)                | 최댓값 |
| ------------ | ------------------------------ | -----: |
| 첫 홈 데이터 | 1565 / 1208 / 1073 / 223 / 210 |   1565 |
| 홈 재진입    | 155 / 405 / 145 / 393 / 147    |    405 |
| 상세 진입    | 341 / 364 / 288 / 308 / 345    |    364 |
| 상세 재진입  | 338 / 261 / 277 / 267 / 291    |    338 |

이 warm 결과로 앞선 초기화 초과 표본을 취소하지 않는다. eslint·전체 lint(기존 warnings)·typecheck와
독립 리뷰를 통과했다. 운영 코드 변경이 없어 production build는 이번 E2E 수정에 대해 다시 실행하지 않았다.

#### 다음 비교 실험의 범위

프로젝트 설정 조회 결과 Fluid Compute=true, region=icn1, Function CPU=Standard였다.
[공식 CPU/메모리 문서](https://vercel.com/docs/functions/configuring-functions/memory)에 따르면
Standard는2GB/1vCPU, Performance는4GB/2vCPU이며 프로젝트의 향후 모든 배포에 적용된다.
`vercel.json`으로 특정 쿠팡 함수만 memory를 변경할 수는 없다.

다음 후보는 같은 코드로 Standard/Performance 배포를 비교하는 실험이다. 초기화가 포함된 첫 요청과
각5회 재진입, API 값·인증 차단, CPU/메모리 사용량을 함께 비교하고 개선이 없으면 Standard로 복원한다.
성능 향상과 총비용 감소를 미리 보장하지 않는다. 메모리 용량 증가와 프로젝트 전체 적용 범위 때문에
이 설정 변경은 별도 확인 후 진행하며, 현재 운영 설정은 변경하지 않았다.
