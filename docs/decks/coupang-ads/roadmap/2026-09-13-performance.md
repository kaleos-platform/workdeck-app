# 쿠팡 광고 관리 성능 진단 및 개선 계획

**Goal:** 배포 환경에서 첫 진입의 주요 데이터를 3초 이내, 같은 기간 재진입의 주요 데이터를 1초 이내 표시한다.

**Architecture:** 기존 workspace 단위 cache와 무효화 helper를 재사용한다. 서버 내부 측정으로 병목을 확인한 뒤 목록 집계와 반복 요청을 줄인다.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, 기존 Next.js cache, Sentry, Playwright.

작성일: 2026-09-13. grill-me 인터뷰와 사용자가 제공한 production Network 스크린샷에 기반한다. 현재 산출물은 진단·개선 방향이며 코드 수정이나 성능 목표 달성을 의미하지 않는다.

## 합의 사항

- 대상은 배포된 Workdeck의 쿠팡 광고 관리 첫 화면과 캠페인 상세다.
- 화면 자체보다 숫자·표의 표시가 늦고, 기다리면 데이터는 모두 나온다.
- 사용자는 두 화면에서 재진입도 36초 이상 걸리는 경험을 보고했다.
- 후속 상세 측정에서는 실제로 몇 초 이내 표시됐다고 확인했다. 상세의 장시간 지연은 아직 재현하지 못했다.
- 업로드·수집·목표 수정 등 데이터 변경 시 무효화하고, 그 외에는 cache 재사용을 허용한다.
- 완료 기준은 클릭부터 주요 숫자·표·차트를 사용할 수 있는 시점이다. 빈 화면 틀이나 모든 background 요청 종료를 기준으로 삼지 않는다.

## 확보한 증거

| 상황    | 요청                                              | HTTP | 소요 시간      |
| ------- | ------------------------------------------------- | ---- | -------------- |
| 첫 화면 | campaigns?startDate=2026-09-06&endDate=2026-09-12 | 200  | 24.92초        |
| 첫 화면 | campaigns                                         | 200  | 22.99초        |
| 첫 화면 | kpi?startDate=2026-09-06&endDate=2026-09-12       | 200  | 4.44초         |
| 첫 화면 | 캠페인별 summary                                  | 200  | 약 0.84~1.06초 |
| 상세    | campaigns                                         | 200  | 8.04초         |
| 상세    | overview?from=2026-09-06&to=2026-09-12            | 200  | 1.87초         |

기간 지정 campaigns Timing: Queueing 1.15ms, Stalled 2.28ms, Request sent 65μs, Waiting for server response 24.91초, Content Download 0.45ms.

첫 화면 목록 요청은 응답을 기다리는 시간이 대부분이다. 이 값에는 서버 처리 외에도 네트워크 왕복 등이 포함되므로 특정 DB 쿼리의 실행 시간으로 해석하지 않는다. 요청들이 겹칠 수 있어 위 시간을 합산하지 않는다. 스크린샷의 단일 관측값은 percentile이나 전체 화면 완료 시간을 증명하지 않는다.

## 코드에서 확인한 구조

- `src/lib/coupang-ads/queries.ts`: queryCampaigns의 catalog는 cache에 있지만 전체 기간 min/max 집계는 밖에 있다. 기간 지정 시 현재·이전 집계도 순차 실행된다. queryKpi 역시 현재·이전 집계를 순차 실행한다.
- `src/components/dashboard/campaign-list-with-metrics.tsx`: 목록 응답 이후 캠페인별 targets/summary를 요청하고, 모두 완료된 뒤 목록 상태를 설정한다.
- `src/components/layout/sidebar.tsx`: pathname 변경마다 /api/campaigns를 다시 요청한다.
- `src/lib/api-helpers.ts`: 일반 사용자 API 요청에서 인증, membership, deck 활성 상태, workspace 조회를 거친다. overview 데이터 cache보다 앞에서 실행된다.
- `src/lib/coupang-ads/campaign-overview.ts`: overview cache가 있고 miss 시 7개 DB 조회를 Promise.all로 요청한다.
- `src/lib/prisma.ts`: production pool 기본값은 1이며 PRISMA_POOL_MAX로 변경 가능하다. 실제 운영 값과 연결 대기는 미확인이다.
- `src/lib/coupang-ads/cache.ts`: workspace tag, 입력별 key, 1시간 revalidate, 즉시 만료 helper가 이미 있다.
- 업로드, collection upload, 캠페인 수정·삭제, 목표·메모·상태 변경 API에 무효화 호출이 존재한다. 이것만으로 모든 수집·수정 경로가 포괄됐다고 판단하지 않는다.
- `e2e/coupang-ads-campaign-detail-perf.spec.ts`: 비활성 탭 API 호출을 검사하지만 실제 표시 시간은 검사하지 않는다.

## 실행 순서와 판단 기준

### 1. 운영 병목 측정

- [ ] app/api/campaigns/route.ts, app/api/dashboard/kpi/route.ts, app/api/campaigns/[campaignId]/overview/route.ts에서 요청 전체와 resolveWorkspace 시간을 분리한다.
- [ ] queries.ts에서 catalog cache 호출, 전체 기간 집계, 현재 집계, 이전 집계 시간을 구분한다. cache loader 실행 여부로 hit/miss를 구분하며 시간만으로 추정하지 않는다.
- [ ] 기존 Sentry span 또는 Server-Timing과 구조화 로그로 측정한다. 인증정보·원본 광고 데이터는 기록하지 않는다.
- [ ] 운영 배포 버전, 실제 pool 설정, DB와 서버 region, 연결 대기와 쿼리 실행 시간을 확인한다. pool 값을 먼저 올리지 않는다.
- [ ] 같은 사용자·기간에서 첫 진입, 재진입, cache miss를 구분해 최소 5회씩 기록한다. production cold start와 데이터 cache miss는 별개로 표시한다.
- [ ] 집계 시간이 지배적이면 실행 계획과 조회량을 확인한다. 인증/연결 대기가 지배적이면 해당 경로부터 개선한다. production 직접 SQL 실행 대신 승인된 관측 도구·로그를 사용하고 재현용 실행 계획은 개발 DB에서 확인한다.

### 2. 목록 조회 비용 축소

- [ ] 측정에서 확인한 비싼 집계를 우선 개선한다. 기존 cacheCoupangAdsData를 사용해 workspace와 기간에 맞는 key를 구성한다.
- [ ] 사이드바와 queryCampaigns의 모든 호출자를 확인하고 필요한 필드만 조회하도록 경로를 정한다. 기존 API·agent tool 응답 계약을 보존한다.
- [ ] 화면 이동마다 동일 목록을 재요청하는 동작을 줄인다. 캠페인 생성·삭제·이름 변경 후 사이드바도 갱신되어야 한다.
- [ ] cold cache에서도 3초 목표를 검증한다. cache만으로 느린 최초 집계를 해결했다고 판단하지 않는다.
- [ ] 집계가 느리다는 근거가 있을 때만 쿼리/인덱스를 변경한다. 스키마 변경은 prisma migrate dev로 migration을 만들고 커밋한다.

### 3. 목표 요약과 정확성

- [ ] 목록이 캠페인별 summary 응답 전체를 기다리는 비용을 재측정한다. 필요하면 목표 이력과 일별 집계를 일괄 조회해 요청 수를 줄인다.
- [ ] 기존 summary와 overview의 날짜·목표 적용 의미를 비교한다. KST 경계, 목표 변경일, 목표 없는 날짜, 광고비 0을 fixture로 검증한 후 통합한다.
- [ ] 업로드·수집·캠페인 변경·목표·메모·키워드/상품 상태 등 모든 쓰기 호출자를 추적한다. 성공 후 관련 cache가 무효화되는지 확인한다.
- [ ] workspace 간 cache 분리와 기간·광고 유형별 결과 분리를 검사한다. 인증 및 권한 검사는 유지한다.
- [ ] client 결과를 재사용한다면 서버 tag 무효화만으로 충분하다고 가정하지 않는다. 변경 후 현재 화면과 재진입 화면이 새 데이터를 읽는지 검증한다.

### 4. 회귀 검증과 완료 판정

- [ ] cache.test.ts에 key와 무효화 회귀를 추가하고, 관련 집계 및 mutation 테스트로 성공 후 갱신과 실패 시 동작을 검증한다. mock 테스트만으로 production cache 적중을 증명하지 않는다.
- [ ] Playwright에서 첫 화면과 상세의 주요 숫자·표·차트 표시 시점을 측정한다. 기존 비활성 탭 요청 제한 검사도 유지한다.
- [ ] `npm run test -- --runInBand src/lib/coupang-ads` 및 변경된 관련 테스트를 실행한다.
- [ ] `npm run lint`, `npm run build`를 실행한다.
- [ ] 인증된 테스트 환경에서 `npx playwright test e2e/coupang-ads-campaign-detail-perf.spec.ts`와 추가한 첫 화면 검사를 실행한다. 인증정보 미설정에 따른 skip은 통과로 취급하지 않는다.
- [ ] 운영에서 동일 조건으로 전후 최소 5회 측정해 원시값·중앙값·최댓값을 기록한다. 표본 내 목표 초과가 있으면 완료 처리하지 않고 초과 조건을 명시한다.
- [ ] 변경 직후 최초 조회와 이미 열린 화면의 갱신까지 검증한다. 실제 데이터 갱신 실험은 테스트 workspace에서 수행한다.

## 아직 확정하지 않은 사항

25초 중 인증·연결 대기·각 집계가 차지하는 시간, 실제 운영 pool 및 DB region, cache hit 비율, 간헐적인 상세 36초 지연 원인. 현재 증거로 DB 증설, pool 확대, 새 cache 서비스 도입을 결정하지 않는다.

## 구현 진행 상황

2026-09-13: 서버 계측, 집계별 cache 재사용, 사이드바 경량 조회·변경 알림 갱신, 목표 요약 일괄 조회, 업로드 commit 이후 cache 무효화, 회귀 테스트와 배포 환경 측정 절차를 구현했다. 상세는 기존 overview cache를 유지하고 loader 계측을 추가했다. 운영 내부 시간과 목표 달성은 아직 실측하지 않았다.

실행 방법과 검증 제약은 [성능 검증 가이드](../guides/performance-verification.md)에 기록한다. 위 운영 측정·완료 판정 항목은 실제 배포 후 결과로 갱신한다.

2026-09-17: PR #888/#889 운영 배포 후 로그인 세션에서 각 흐름 5회 측정했다.
상세 재진입은 0.27~0.56초였으나 첫 화면 최댓값 5.78초, 상세 진입 8.03초로 완료 기준 미달이다.
로그인 직후 catalog loader 17.49초, 날짜 범위 3.24초도 관측했다.
후속으로 전체 원본 정렬을 없애는 catalog SQL 변경과 overview 개별 쿼리 계측을 구현했다.
개발 DB 실행 계획 비교 및 임시 15만 행 회귀 테스트를 통과했다. 후속 운영 배포·재측정은 남아 있다.

### 2026-09-17 인덱스 후속 계획

PR #890/#891 배포 후에도 최초 catalog 19.42초, overview 광고유형 조회 13.94초로 목표 미달이다.
목록 쿼리 변경만으로 최초 조회 문제가 해결되지 않았으므로 캐시와 별도로 DB 접근 경로를 개선한다.

- [ ] 개발 DB에서 catalog/adType 조회 실행 계획과 5회 시간을 기록한다.
- [ ] `AdRecord(workspaceId, campaignId, adType, date)` 복합 인덱스를 schema에 추가하고 `prisma migrate dev --name coupang_ads_catalog_index`로 생성·적용한다.
- [ ] 같은 개발 데이터에서 index-only scan 사용, 읽은 block 수, 결과 동등성, 처리 시간 변화를 검증한다. 기존 최신 이름·workspace·전체 정렬 회귀 테스트도 실행한다.
- [ ] 단위 테스트, lint, build와 리뷰 후 develop → main 절차로 배포한다. 운영 직접 SQL은 실행하지 않는다.
- [ ] 운영 응답 동등성과 5회 화면 표시 시간을 다시 기록한다. pool 설정은 유지하고 남은 목표 초과를 숨기지 않는다.

### 첫 화면 데이터 전달 후속

인덱스 운영 적용 후 상세 최초 5회는 0.38~1.95초, 재진입은 0.29~0.55초로 목표를 충족했다.
첫 화면 5회는 2.07~8.02초, 재진입 0.43~1.33초로 여전히 미달이다.
브라우저에서 HTML 응답 완료 후에야 KPI·목록 API가 시작되는 순차 대기가 확인됐다.

- [x] 홈 서버에서 기존 workspace 범위의 KPI·목록 조회를 병렬로 시작해 초기 결과를 전달한다.
- [x] 클라이언트는 초기 결과를 즉시 표시하고 기존 API 재검증을 계속한다. 기간 변경 중에는 이전 기간 숫자를 표시하지 않으며, 오래된 응답이 새 기간을 덮지 않게 한다.
- [x] 초기값 표시, 서버 props 갱신, 날짜 변경, 재검증 결과 반영 회귀 테스트를 먼저 작성한다.
- [x] 홈 E2E는 특정 API 완료 대신 실제 KPI·카드 표시를 기준으로 측정하도록 수정한다. API 정확성 검사는 별도로 유지한다.
- [x] 검증·리뷰·배포 후 동일 조건으로 재측정한다. 인증/권한 검사를 생략하거나 사용자 정보를 전역 cache에 저장하지 않는다.

### 2026-09-22 남은 작업

- [x] 최신 main 반영, 38개 테스트·typecheck·lint·build 재검증, PR #901/#902 통합과 운영 배포.
- [x] 같은 기간 배포 전후 5회 측정 및 초기 데이터·날짜 변경 정확성 확인.
- [x] 운영 원시값과 중앙값·최댓값을 성능 검증 가이드에 기록.
- [ ] 홈 재진입 1초 목표 안정화: 날짜 범위 최적화 배포 후 5회 중 1.333초 표본이 남음. 나머지 0.066~0.836초. 이전 full prefetch 측정의 목표 충족과 구분함.
- [ ] 직접 URL 최초 진입 3초 목표: 날짜 범위 최적화 배포 직후 3.628초(DOM 3.150초) 표본이 남음. 인증·레이아웃/서버 초기화 및 RSC 대기 분리가 필요함.
- [x] 상세 재진입 1초 목표: 날짜 범위 최적화 배포 후 최신 5회 0.278~0.500초. 상세 최초도 0.290~1.703초로 3초 목표 충족.
- [x] 일회용 개발 workspace에서 실제 캠페인 이름 변경 후 상세·사이드바·홈/상세 재진입 갱신 및 복원 검증. Playwright 테스트 통과, 생성 데이터 삭제 완료.

이전 실행 순서의 체크박스는 초기 계획 기록이다. 최신 실행 결과는 위 항목 및 성능 검증 가이드의 날짜별 결과를 따른다.

2026-09-22 후속: 요청 내 인증 중복 제거, 신규 DB 연결·이벤트 루프 계측, small compiler 적용을 PR #912~#917로 배포했다. 관련 41개 테스트와 실제 변경 갱신 E2E, lint/build/typecheck 통과. 최신 홈 최초/재진입 중앙값은 0.483/0.825초, 상세는 0.405/0.320초다. 홈 최댓값 목표 초과는 남아 있으며 완료로 처리하지 않는다. 상세 결과와 관측 한계는 성능 검증 가이드에 기록했다.

2026-09-22 full prefetch 후속: PR #920/#921 운영 배포, 45 tests·production-mode 실제 prefetch/변경 갱신 E2E·lint/build/typecheck 통과. 이름·삭제·업로드·예산/ROAS 변경 시 Router Cache 무효화. 홈 재진입과 상세는 최신 5회 목표 충족, 직접 URL 배포 직후 표본은 미달로 유지한다.

2026-09-23: PR #924/#925로 catalog 전체 이력 스캔을 기존 index의 그룹별 탐색으로 대체했다. 임시15만행 SQL출력동등성·실행계획검증, 45단위회귀+2실제DB테스트·lint/build/typecheck 통과. 모든운영API200·KPI일치·비로그인401 확인. 최신 직접URL/상세재진입초과는 미완료로 유지하며 원시값을 보관했다.

2026-09-23 날짜 범위 후속: PR #929/#930 운영 배포 및 46단위회귀+3실제DB테스트·lint/build/typecheck·리뷰 완료. 날짜 전체 이력 집계를 index 양 끝 조회로 교체하고 캠페인 ID별 cache 분리로 업로드 경합을 방지했다. Proxy 세션 및 layout 계측을 추가했다. 5회 운영 재측정·KPI 일치·비로그인401 확인. 추가 브라우저 네트워크 추적은 Playwright MCP `Transport closed`로 중단됐으며 홈의 두 목표는 미완료로 유지한다.
