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

운영 배포 전후 측정, cold cache 3초 및 재진입 1초 목표 달성 여부는 아직 확인되지 않았다.
