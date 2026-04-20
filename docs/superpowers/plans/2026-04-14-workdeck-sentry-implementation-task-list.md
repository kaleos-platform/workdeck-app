# Workdeck Sentry 적용 태스크 리스트

작성일: 2026-04-14
작성자: 칼스
기준 문서: `docs/superpowers/plans/2026-04-14-workdeck-sentry-qa-automation-plan.md`
목표: Workdeck 실제 코드베이스 기준으로 Sentry 도입과 QA 자동화 연결 작업을 파일 단위로 분해한다.

## 1. 결론

됩니다.

그리고 현재 코드 기준으로는 _웹 앱보다 worker와 API 경로 계측이 더 급합니다._
이유는 최근 장애 유형이 frontend crash보다 아래에 집중돼 있기 때문입니다.

- 수집 성공 후 후속 분석/Slack 실패
- scheduler는 돌았지만 조건 때문에 스킵된 상황 해석 어려움
- worker 내부 단계 실패가 로그에만 남고 구조화되지 않음
- Slack env 누락, selector 변경, 업로드 0건 같은 soft failure가 alert로 승격되지 않음

따라서 P0 범위는 아래입니다.

- `app/api/*` 주요 route 계측
- `worker/src/*` 핵심 파이프라인 계측
- Slack notifier 실패 구조화
- scheduler heartbeat 이벤트 추가

---

## 2. 현재 코드베이스 확인 결과

### 이미 확인된 점

- 메인 앱 `package.json`에는 `@sentry/nextjs`가 이미 포함돼 있음
- 하지만 실제 Sentry 설정 파일 존재는 아직 확인되지 않음
- worker는 별도 package로 분리돼 있고 현재 Sentry 의존성이 없음
- Playwright는 앱과 worker 양쪽에 이미 사용 중

### 실제 핵심 파일

_웹 / API_

- `app/api/collection/runs/route.ts`
- `app/api/analysis/trigger/route.ts`
- `app/api/analysis/reports/[reportId]/complete/route.ts`
- `app/api/inventory/upload/route.ts`
- `app/api/inventory/analysis/route.ts`
- `app/api/inventory/analysis/worker/route.ts`
- `app/api/collection/upload/route.ts`
- `app/layout.tsx`

_worker_

- `worker/src/index.ts`
- `worker/src/orchestrator.ts`
- `worker/src/collection-scheduler.ts`
- `worker/src/analysis-scheduler.ts`
- `worker/src/manual-poller.ts`
- `worker/src/analysis-poller.ts`
- `worker/src/slack-notifier.ts`
- `worker/src/collector.ts`
- `worker/src/inventory-collector.ts`
- `worker/src/api-client.ts`

이 파일들이 1차 적용 대상입니다.

---

## 3. 구현 원칙

### 원칙 1. 예외만 잡지 않는다

Workdeck는 배치 시스템입니다.
따라서 `throw`가 없는 실패도 이벤트로 남겨야 합니다.

예:

- Slack env 없음
- 분석 interval 미도달로 스킵
- 업로드 결과 insertedRows = 0
- selector fallback 발생
- worker 인증 실패 후 세션 fallback

### 원칙 2. route 단위보다 run 단위로 본다

Sentry 이벤트는 request 중심이 아니라 아래 단위를 따라야 합니다.

- `workspaceId`
- `runId`
- `reportId`
- `scheduleId`
- `triggeredBy`
- `service`

### 원칙 3. 운영 판단 가능한 메시지만 남긴다

단순히 `Analysis failed`로 끝내면 안 됩니다.
최소 아래가 같이 들어가야 합니다.

- 어떤 workspace인지
- 어떤 단계인지
- 재시도 가능한 문제인지
- soft failure인지 hard failure인지

---

## 4. P0 구현 태스크

## P0-1. Next.js Sentry bootstrap 정리

### 목표

웹 앱과 API route에서 공통 Sentry 초기화를 확정한다.

### 작업

- [ ] `sentry.server.config.*` 추가 또는 정비
- [ ] `sentry.edge.config.*` 필요 여부 판단
- [ ] `instrumentation.ts` 또는 Next.js 16 기준 Sentry 초기화 경로 정리
- [ ] `app/layout.tsx`에서 client init 필요 여부 점검
- [ ] `next.config.*`에 Sentry plugin 적용 여부 확인
- [ ] source map 업로드/release 설정 정리

### 대상 파일

- `package.json`
- `next.config.*`
- `app/layout.tsx`
- `instrumentation.ts` 또는 Sentry config 파일들

### 완료 기준

- API route exception이 Sentry에 들어감
- release / env 태그가 자동으로 붙음
- PII scrub 정책이 기본 적용됨

### 비고

`@sentry/nextjs`는 이미 dependency에 있습니다.
즉, 설치보다 *정상 부트스트랩 검증*이 우선입니다.

---

## P0-2. 공통 observability helper 추가

### 목표

route와 worker 양쪽에서 같은 방식으로 이벤트를 남기게 한다.

### 작업

- [ ] `lib/observability/` 또는 `lib/sentry/` 디렉토리 추가
- [ ] 공통 helper 작성
  - `setWorkdeckContext()`
  - `captureWorkdeckMessage()`
  - `captureWorkdeckException()`
  - `withWorkdeckScope()`
- [ ] 표준 tags/context schema 정의
- [ ] scrub 대상 필드 정의
  - password
  - token
  - cookie
  - loginId 직접 노출 방지

### 대상 파일

- 신규: `lib/observability/sentry.ts`
- 신규: `lib/observability/workdeck-event.ts`
- 필요 시: `lib/api-helpers.ts`

### 완료 기준

- route handler가 반복 코드 없이 context 주입 가능
- worker에서도 동일 taxonomy 사용 가능

---

## P0-3. collection run API 계측

### 목표

수집 시작, 충돌, 자격증명 없음, 타임아웃 정리를 구조화한다.

### 작업

- [ ] `GET /api/collection/runs`의 stale run 정리 시 warning event 추가
- [ ] `POST /api/collection/runs`의 active run 충돌을 info/warning event로 기록
- [ ] 자격증명 없음 에러를 structured message로 기록
- [ ] worker 호출인지 manual 호출인지 tag 부여

### 대상 파일

- `app/api/collection/runs/route.ts`
- 가능하면 `app/api/collection/runs/[runId]/route.ts`
- 가능하면 `app/api/collection/runs/pending/route.ts`

### 이벤트 예시

- `collection_run.created`
- `collection_run.conflict`
- `collection_run.stale_timeout`
- `collection_run.failed_missing_credentials`

### 완료 기준

- 수집 요청이 왜 시작 안 됐는지가 Sentry에서 보임

---

## P0-4. analysis trigger 경로 계측

### 목표

분석 생성, 스케줄 기반 생성, 실패 저장을 모두 추적한다.

### 작업

- [ ] `app/api/analysis/trigger/route.ts`에 report 생성 event 추가
- [ ] worker/manual trigger 구분 tag 추가
- [ ] invalid reportType, invalid date, workspace 누락 등의 validation failure를 message로 기록
- [ ] `app/api/analysis/reports/[reportId]/complete/route.ts`에서 COMPLETED / FAILED 이벤트 추가
- [ ] metadata.activeRuleIds, suggestion count, processing duration 등 context 추가 검토

### 대상 파일

- `app/api/analysis/trigger/route.ts`
- `app/api/analysis/reports/[reportId]/complete/route.ts`
- 권장 추가: `app/api/analysis/reports/[reportId]/run/route.ts`
- 권장 추가: `app/api/analysis/reports/pending/route.ts`

### 이벤트 예시

- `analysis_report.created`
- `analysis_report.completed`
- `analysis_report.failed`
- `analysis_trigger.validation_failed`

### 완료 기준

- "분석은 트리거됐는가", "어디서 실패했는가"가 명확해짐

---

## P0-5. inventory upload / analysis 경로 계측

### 목표

최근 실제 장애와 가장 가까운 경로를 먼저 계측한다.

### 작업

- [ ] `app/api/inventory/upload/route.ts`에서 파일 다운로드 실패, 파일 크기 초과, 업로드 실패 이벤트 추가
- [ ] fire-and-forget 분석 호출 실패를 warning이 아닌 error event로 승격
- [ ] `app/api/inventory/analysis/route.ts`에서 worker auth 실패 후 session fallback을 warning으로 기록
- [ ] 분석 결과 없음 (`result == null`)을 정상 404인지 운영 경고인지 분리 기록
- [ ] worker 전용 inventory analysis route에도 동일 taxonomy 적용

### 대상 파일

- `app/api/inventory/upload/route.ts`
- `app/api/inventory/analysis/route.ts`
- `app/api/inventory/analysis/worker/route.ts`
- 권장 추가: `app/api/inventory/upload-worker/route.ts`

### 이벤트 예시

- `inventory_upload.download_failed`
- `inventory_upload.completed`
- `inventory_analysis.started`
- `inventory_analysis.no_data`
- `inventory_analysis.failed`
- `inventory_analysis.auth_fallback`

### 완료 기준

- 재고 업로드 후 분석/Slack 누락 경로를 역추적 가능

---

## P0-6. worker bootstrap + process-level 핸들러

### 목표

worker 프로세스 crash, unhandled rejection, scheduler loop failure를 전역 수집한다.

### 작업

- [ ] worker package에 Sentry 의존성 추가
  - 우선 `@sentry/node`
- [ ] `worker/src/index.ts`에 Sentry init 추가
- [ ] `process.on('uncaughtException')`, `process.on('unhandledRejection')` 연결
- [ ] `service=worker` 또는 `service=scheduler` tag 기본 적용
- [ ] worker release/env 태그 설정

### 대상 파일

- `worker/package.json`
- `worker/src/index.ts`
- 신규: `worker/src/observability.ts`

### 완료 기준

- worker가 죽거나 promise rejection이 누락돼도 Sentry에 남음

---

## P0-7. orchestrator 단계별 계측

### 목표

Workdeck 운영의 핵심 실패 지점을 단계별로 가시화한다.

### 작업

- [ ] `runCollection()` 시작 시 transaction/message 생성
- [ ] `createCollectionRun` 성공 시 `runId` scope 반영
- [ ] 자격증명 복호화 실패 captureException
- [ ] 다운로드 시작/완료 breadcrumb 남김
- [ ] `verifyDownloadedFile` 날짜 불일치 시 error event 남김
- [ ] 업로드 결과에서 insertedRows=0 또는 duplicate만 존재 시 warning event 남김
- [ ] inventory 수집 실패를 collection 성공과 분리된 warning/error로 기록
- [ ] inventory analysis trigger 실패 event 추가
- [ ] post-collection analysis trigger 실패 event 추가
- [ ] Slack 알림 실패를 stdout 로그가 아닌 structured event로 기록

### 대상 파일

- `worker/src/orchestrator.ts`
- `worker/src/api-client.ts`
- `worker/src/collector.ts`
- `worker/src/inventory-collector.ts`

### 이벤트 예시

- `ad_collection.start`
- `ad_collection.download_completed`
- `ad_collection.file_date_mismatch`
- `ad_collection.upload_completed`
- `inventory_collection.failed`
- `inventory_analysis.trigger_failed`
- `analysis.trigger_failed_post_collection`

### 완료 기준

- 수집 전체 파이프라인이 단계 단위로 복원 가능

---

## P0-8. scheduler heartbeat 계측

### 목표

"스케줄러가 안 돈 건지, 돌았는데 조건 불충족인지"를 분리한다.

### 작업

- [ ] `worker/src/collection-scheduler.ts`에 tick event 추가
- [ ] schedules.length == 0도 info로 기록
- [ ] cron mismatch는 남발하지 말고 요약형 breadcrumb 또는 sample event로 기록
- [ ] 실제 실행 시작/완료/실패를 별도 event로 기록
- [ ] `worker/src/analysis-scheduler.ts`에 active schedules 조회 성공/실패 기록
- [ ] `needsAnalysis()` 결과가 false인 주요 스킵 이유를 추적 가능하게 변경
  - disabled
  - triggerAfterCollection mode
  - hour mismatch
  - interval 미도달

### 대상 파일

- `worker/src/collection-scheduler.ts`
- `worker/src/analysis-scheduler.ts`

### 이벤트 예시

- `scheduler.tick.collection`
- `scheduler.tick.analysis`
- `scheduler.collection.triggered`
- `scheduler.analysis.skipped_interval`
- `scheduler.analysis.fetch_failed`

### 완료 기준

- 스케줄 관련 운영 문의에 로그 grep 없이 답 가능

---

## P0-9. Slack notifier 실패 구조화

### 목표

Slack 알림 실패를 "조용한 실패"로 남기지 않는다.

### 작업

- [ ] env 누락 시 단순 skip 로그 대신 Sentry warning 기록
- [ ] Slack API `ok=false` 응답 captureMessage/error
- [ ] 네트워크 에러 captureException
- [ ] 성공/실패 모두 message taxonomy 적용
- [ ] 가능하면 알림 종류별 tag 추가
  - ad_collection
  - inventory_collection
  - analysis_done
  - collection_failed

### 대상 파일

- `worker/src/slack-notifier.ts`
- 필요 시 웹 앱의 Slack 관련 코드도 동일 패턴 적용

### 이벤트 예시

- `slack_notification.skipped_missing_env`
- `slack_notification.failed_api`
- `slack_notification.failed_network`
- `slack_notification.sent`

### 완료 기준

- Slack 누락이 별도 운영 경고로 잡힘

---

## 5. P1 구현 태스크

## P1-1. analysis poller / manual poller 계측

### 목표

대기열 기반 worker 흐름을 추적한다.

### 대상 파일

- `worker/src/manual-poller.ts`
- `worker/src/analysis-poller.ts`

### 작업

- [ ] poll 시작/empty/success/failure 기록
- [ ] reportId/runId 기준 context 연결
- [ ] polling latency 측정

---

## P1-2. UI smoke QA 작성

### 목표

배포 직후 최소한의 운영 확인을 자동화한다.

### 권장 시나리오

- [ ] 로그인 페이지 접근
- [ ] 인증 후 `/d/coupang-ads` 진입
- [ ] `/d/coupang-ads/upload` 렌더
- [ ] `/d/coupang-ads/analysis` 리포트 리스트 렌더
- [ ] `/d/coupang-ads/inventory` 요약 카드 렌더
- [ ] `/d/coupang-ads/settings` 스케줄 정보 조회

### 대상 파일

- 신규: `playwright.config.ts` 또는 기존 config 정비
- 신규: `tests/e2e/*.spec.ts`

### 완료 기준

- preview 배포 후 smoke pass/fail 판정 가능

---

## P1-3. smoke 실패 → Sentry 연결

### 목표

테스트 실패와 운영 release를 연결한다.

### 작업

- [ ] Playwright 실패 시 screenshot 저장
- [ ] trace 저장
- [ ] CI 또는 스크립트에서 Sentry event 업로드
- [ ] release tag 포함

---

## P1-4. runbook 문서 작성

### 우선 작성 문서

- [ ] `docs/runbooks/worker-failure-response.md`
- [ ] `docs/runbooks/slack-notification-failure.md`
- [ ] `docs/runbooks/analysis-pipeline-failure.md`
- [ ] `docs/runbooks/external-ui-selector-breakage.md`
- [ ] `docs/runbooks/scheduler-heartbeat-missing.md`

---

## 6. 권장 구현 순서

### Sprint 1

1. Next.js bootstrap 확인
2. 공통 helper 작성
3. inventory / analysis / collection API 계측
4. worker bootstrap
5. orchestrator + Slack notifier 계측

### Sprint 2

1. scheduler heartbeat
2. poller 계측
3. alert rule 연결
4. runbook 1차 작성

### Sprint 3

1. Playwright smoke 구축
2. smoke -> Sentry 연결
3. noise tuning
4. dashboard / saved search 구성

이 순서가 맞습니다.
_가장 최근 실제 장애를 먼저 덮는 경로부터 계측해야 합니다._

---

## 7. 파일별 세부 작업표

### `app/api/inventory/analysis/route.ts`

- [ ] worker auth fallback warning
- [ ] analysis start/success/failure 이벤트
- [ ] no data 404 분리 기록
- [ ] workspaceId, triggeredBy 태그 추가

### `app/api/inventory/upload/route.ts`

- [ ] storage download failure 기록
- [ ] file too large warning
- [ ] processInventoryUpload 결과 이상치 기록
- [ ] fire-and-forget analysis failure 구조화

### `app/api/analysis/trigger/route.ts`

- [ ] validation failure 기록
- [ ] report created event
- [ ] worker/manual source 구분

### `app/api/analysis/reports/[reportId]/complete/route.ts`

- [ ] completed/failed event
- [ ] suggestion count, activeRuleIds context
- [ ] metadata safe serialization

### `app/api/collection/runs/route.ts`

- [ ] stale timeout event
- [ ] active run conflict event
- [ ] missing credential event
- [ ] run created event

### `worker/src/index.ts`

- [ ] Sentry init
- [ ] process-level handler
- [ ] scheduler loop guard event

### `worker/src/orchestrator.ts`

- [ ] main pipeline transaction
- [ ] step breadcrumb
- [ ] file date mismatch error
- [ ] upload result anomaly warning
- [ ] inventory failure 분리 기록
- [ ] analysis/slack trigger failure 기록

### `worker/src/collection-scheduler.ts`

- [ ] tick event
- [ ] no schedule info event
- [ ] triggered/completed/failed event

### `worker/src/analysis-scheduler.ts`

- [ ] fetch success/failure
- [ ] skipped reason taxonomy
- [ ] trigger success/failure

### `worker/src/slack-notifier.ts`

- [ ] missing env warning
- [ ] api false response error
- [ ] network exception capture
- [ ] notification type 태그

---

## 8. 완료 판정 기준

아래 질문에 답할 수 있으면 1차 성공입니다.

- 수집이 오늘 왜 실행 안 됐는가?
- 수집은 성공했는데 재고 분석은 왜 실패했는가?
- Slack 알림은 왜 빠졌는가?
- scheduler는 죽은 것인가, 조건 미충족인가?
- 특정 release 이후부터 실패가 시작됐는가?

지금 Workdeck에 필요한 건 바로 이 답변 능력입니다.

---

## 9. 제안

다음 실행은 이걸로 가면 됩니다.

1. _문서 승인_
2. _P0 구현 착수_
3. _inventory / analysis / worker bootstrap부터 적용_

제 판단은 이겁니다.
_P0만 제대로 해도 Workdeck 운영 가시성은 체감상 크게 올라갑니다._

원하시면 다음 단계로 바로

- `Sentry 이벤트 taxonomy 문서`를 별도 파일로 분리하거나
- `실제 구현 브랜치 작업`까지 이어가겠습니다.
