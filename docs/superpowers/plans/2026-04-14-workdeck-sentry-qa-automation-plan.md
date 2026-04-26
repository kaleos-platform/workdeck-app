# Workdeck Sentry 기반 QA 자동화 계획

작성일: 2026-04-14
작성자: 칼스
목표: Workdeck의 안정적인 운영을 위해, 장애를 사후 발견하는 수준을 넘어서 배포 직후와 운영 중 문제를 조기에 감지하고 재현 가능한 형태로 수집하는 QA 자동화 체계를 구축한다.

## 1. 결론

됩니다.

다만 Sentry만 붙인다고 QA 자동화가 완성되지는 않습니다. Sentry는 본질적으로 "운영 관측 + 오류 수집 + 회귀 감지" 계층입니다. 따라서 Workdeck 안정 운영을 위해서는 아래 3축으로 설계해야 합니다.

- 1축. Sentry 기반 런타임 관측, 예외 수집, 성능 저하 감지
- 2축. 핵심 사용자 플로우 자동 검증, Playwright smoke/regression
- 3축. 배포 게이트, 재현 로그, 담당자 알림 연결

즉, Sentry를 QA 자동화의 중심 이벤트 허브로 두고, 테스트 자동화와 운영 대응 체계를 연결해야 합니다.

## 2. 현재 Workdeck에 필요한 문제 정의

최근 확인된 운영 이슈를 기준으로 보면 Workdeck의 리스크는 크게 4종입니다.

- 수집 성공, 후속 분석/알림 실패
- 외부 UI 변경으로 인한 Playwright 수집기 오작동
- 배포 환경변수/인증 차이로 인해 로컬 정상, 운영 실패
- 비정상 상태가 발생했지만 Slack 알림이나 재시도 정책이 부족해 늦게 인지됨

이 구조에서는 "실패를 막는 것"보다 먼저 "실패를 즉시 보이게 하는 것"이 중요합니다.

## 3. 목표 상태

### 운영 목표

- 핵심 플로우 실패를 5분 이내 감지
- 배포 후 주요 기능 이상 여부를 자동 확인
- 장애 발생 시 재현 정보, 사용자 영향 범위, 최근 배포 연관성을 즉시 확인
- Slack 알림이 누락돼도 Sentry에서 별도로 감지 가능
- 반복 장애는 이슈 그룹화와 회귀 감지로 재발 여부 추적

### QA 목표

- 수동 확인이 필요한 운영 점검을 자동화
- 광고 수집, 재고 수집, 분석 생성, Slack 발송까지 E2E 상태를 추적
- 프론트엔드 에러, API 5xx, worker 실패, 스케줄 미실행을 각각 분리 감시

## 4. 설계 원칙

### 4.1 Sentry의 역할

Sentry는 다음 용도로 사용합니다.

- Frontend runtime error 추적
- Next.js API route exception 추적
- Worker process error 추적
- Cron/scheduler/job 실패 추적
- 성능 저하, 느린 API, 긴 작업 추적
- release 단위 회귀 감지
- alert routing, Slack/이메일 연결

### 4.2 Sentry가 하지 못하는 것

Sentry만으로는 아래를 보장할 수 없습니다.

- 외부 UI 변경 사전 탐지
- 버튼은 보이지만 실제 플로우가 깨지는 문제 검증
- 데이터 정합성 검증
- "메시지는 보냈지만 내용이 틀린" 문제 탐지

이 부분은 Playwright, synthetic check, domain assertion으로 보완해야 합니다.

## 5. 구현 범위

## Phase 1. Sentry 표준 도입

목표: Workdeck 전 계층에서 장애를 빠짐없이 수집한다.

### 적용 대상

- Next.js app
- API routes / server actions
- worker
- cron/scheduler
- 분석 poller / collection poller

### 해야 할 일

- Sentry 프로젝트 분리 또는 environment 태깅 전략 수립
  - workdeck-web
  - workdeck-worker
  - workdeck-scheduler
- environments 구분
  - local
  - preview
  - production
- release 연동
  - git sha 기반 release tagging
- source map 업로드
- 사용자/워크스페이스/작업 ID 태깅
  - workspaceId
  - runId
  - reportId
  - scheduleId
  - triggeredBy
- 민감정보 마스킹 정책 적용
  - 로그인 ID, password, token, cookie 제외

### 기대 효과

- "어디서 실패했는지"가 아니라 "어느 workspace의 어떤 run이 왜 실패했는지"까지 바로 추적 가능

## Phase 2. 핵심 비즈니스 이벤트 계측

목표: 예외가 없어도 실패 상태를 감지할 수 있게 한다.

예외만 수집하면 부족합니다. Workdeck는 배치/자동화 성격이 강해서 "조용한 실패"가 더 위험합니다.

### 계측 대상 이벤트

- 광고 수집 시작 / 성공 / 실패
- 재고 수집 시작 / 성공 / 실패
- 분석 트리거 시작 / 성공 / 실패 / 스킵
- Slack 발송 시작 / 성공 / 실패 / 스킵
- 스케줄 체크 결과
  - 실행 대상 없음
  - interval 미도달
  - 인증 실패
  - 환경변수 누락
- 외부 사이트 UI selector fallback 발생
- 다운로드 버튼 탐색 실패
- 업로드 결과 이상
  - insertedRows = 0
  - duplicateRows만 존재
  - expected date mismatch

### 구현 방식

- `captureException` for hard failures
- `captureMessage` for soft failure / abnormal state
- breadcrumb로 단계별 흐름 기록
- transaction/span으로 실행 시간 측정
- structured tags/extras 표준화

### 예시

- 재고 수집 성공 후 분석 미실행
  - exception이 아니어도 warning event 생성
- Slack env 누락으로 알림 스킵
  - info가 아니라 warning으로 기록
- intervalDays 때문에 스킵
  - 정상 스킵이더라도 운영 판단용 breadcrumb 남김

## Phase 3. Alert 정책 설계

목표: 중요한 실패만 즉시 알리고, 잡음은 줄인다.

### 즉시 알림 대상

- production API 5xx 급증
- collection run 실패
- inventory run 실패
- analysis trigger 실패
- Slack 발송 실패
- worker process crash
- scheduler 2회 연속 미실행

### 묶어서 보는 대상

- preview 프론트엔드 JS 오류
- 일시적 외부 API timeout
- 동일 selector failure 반복

### 권장 알림 채널

- 운영 치명도 높음: Slack #agent-dev 즉시 전송
- 중간 치명도: Sentry issue digest
- 낮음: daily review 또는 주간 triage

### 알림 규칙 예시

- 동일 workspace에서 collection 실패 2회 연속 → high
- 전체 production에서 30분 내 API 5xx 10건 이상 → high
- inventory analysis skipped가 3일 이상 반복 → medium
- Slack message failed 1회라도 발생 → high

## Phase 4. Playwright smoke QA 자동화

목표: 배포 직후 핵심 플로우가 실제로 동작하는지 검증한다.

### 우선순위 시나리오

1. 로그인 후 대시보드 진입
2. 광고 데이터 업로드/조회 화면 정상 렌더
3. 분석 페이지 로딩 및 최근 리포트 표시
4. 재고 현황 페이지 로딩
5. 설정 페이지에서 스케줄/자격증명 조회 가능

### worker/synthetic 시나리오

1. 쿠팡 광고센터 로그인 가능 여부
2. 보고서 페이지 이동 성공 여부
3. 재고현황 메뉴 진입 가능 여부
4. 다운로드 버튼 locator 존재 여부

### 운영 방식

- preview 배포 후 smoke test 실행
- production 배포 직후 read-only synthetic 실행
- 실패 시 Sentry event + Slack 알림

## Phase 5. 배포 게이트와 운영 런북 연결

목표: 장애를 감지하는 데서 끝내지 않고 복구 시간을 줄인다.

### 해야 할 일

- Sentry issue에서 최근 release 연결
- 장애 유형별 runbook 작성
  - env 누락
  - worker auth 401
  - selector 변경
  - Slack 발송 실패
  - OpenRouter/LLM 실패
- 주요 에러 fingerprint 정리
- known issue mute 정책 수립

### 배포 게이트 예시

- preview smoke fail 시 production 승격 금지
- production release 후 10분 내 high alert 발생 시 rollback 검토

## 6. Workdeck 기준 우선순위

### P0, 이번 주

- Next.js + worker에 Sentry 기본 SDK 연동
- production/preview/local environment 분리
- release tagging 적용
- collection/inventory/analysis/slack 경로에 핵심 이벤트 계측
- Slack 발송 실패를 warning이 아닌 alertable event로 상향

### P1, 다음 단계

- Playwright smoke suite 구축
- 배포 후 자동 smoke 실행
- scheduler heartbeat 감시
- runbook 문서화

### P2, 이후 고도화

- Sentry Performance/APM 적용
- cron drift 및 long-running job 감시
- replay/session replay 일부 적용 검토
- user impact dashboard 구성

## 7. 기술 구현안

### Frontend / Next.js

- `@sentry/nextjs` 도입
- app router, server action, route handler 예외 수집
- error boundary와 연동
- 사용자 액션 breadcrumb 추가

### Worker

- Node SDK 적용
- process-level handlers 연결
  - uncaughtException
  - unhandledRejection
- 각 job 실행 시 Sentry scope 설정
- workspaceId/runId/reportId tagging

### 스케줄러/폴러

- 매 실행마다 transaction 생성
- 실행 결과를 success/failure/skipped로 구분 기록
- "스케줄은 돌았지만 아무 작업 안 함"도 메타데이터로 남김

### Slack 연동

- Sentry alert → Slack
- 자체 Slack notifier 실패 시 Sentry에도 이중 기록
- 가능하면 alert routing을 app Slack과 ops Slack로 분리

## 8. 문서 산출물 제안

아래 4개 문서로 분리 관리하는 것이 좋습니다.

- `docs/ops/sentry-observability-architecture.md`
- `docs/ops/qa-automation-roadmap.md`
- `docs/runbooks/worker-failure-response.md`
- `docs/runbooks/slack-notification-failure.md`

이번 단계에서는 우선 본 문서를 master plan으로 사용하고, 구현 착수 시 세부 문서로 분리하면 됩니다.

## 9. 리스크와 트레이드오프

### 장점

- 장애 인지 속도가 빨라짐
- 원인 추적 시간이 짧아짐
- 배포 회귀를 빠르게 잡을 수 있음
- Workdeck 운영이 사람 기억이 아니라 시스템 기록 중심으로 바뀜

### 비용

- 계측 코드 추가 필요
- 알림 정책을 잘못 잡으면 noise 증가
- 외부 UI 기반 worker는 synthetic/Playwright 유지보수 비용 존재

### 판단

이 비용은 감수할 가치가 있습니다.
현재 Workdeck의 장애 유형은 "기능 없음"보다 "보이지 않는 실패"가 더 큰 문제입니다. Sentry 중심 QA 자동화는 이 문제에 직접 맞습니다.

## 10. 권장 실행 순서

1. Sentry SDK를 web/worker에 먼저 붙인다.
2. collection, inventory, analysis, slack 경로를 event taxonomy로 표준화한다.
3. high-severity alert rule부터 최소 세트로 건다.
4. preview smoke test를 붙인다.
5. production synthetic check와 runbook을 연결한다.

## 11. 최종 제안

Workdeck의 목표가 "안정적인 운영"이라면, Sentry는 부가 기능이 아니라 운영 코어로 들어가야 합니다.

추천안은 아래입니다.

- Sentry를 단순 에러 로깅이 아니라 운영 이벤트 허브로 사용
- Playwright smoke QA를 배포 게이트로 연결
- worker, scheduler, Slack notifier까지 포함한 end-to-end 관측 체계 구축

즉,
"테스트 자동화"와 "운영 관측"을 분리하지 말고,
_Sentry + Playwright + Slack alert + runbook_ 조합으로 하나의 운영 안정화 체계를 만드는 것이 맞습니다.

원하시면 다음 단계로 바로

- `Sentry 도입 세부 실행 계획`
- `이슈 taxonomy / alert rule 표준안`
- `Workdeck 실제 코드 기준 적용 체크리스트`
  까지 이어서 작성하겠습니다.

## 12. 구체 실행 계획

### 12.1 작업 분류

이 작업은 M입니다.

이유는 간단합니다.

- 단순 SDK 설치가 아니라 web, API, worker, scheduler 전 계층 표준화가 필요함
- QA 자동화와 운영 alert 정책이 같이 설계돼야 함
- 문서, 구현, 검증 기준이 함께 맞물림

따라서 실행은 "문서 확정 → 계측 표준화 → 우선 구현 → smoke QA → 운영 룰 조정" 순서로 가야 합니다.

### 12.2 최종 산출물

이번 계획을 실제 실행 가능한 형태로 바꾸면 산출물은 6개입니다.

1. Sentry integration spec
2. Event taxonomy spec
3. Alert policy spec
4. Playwright smoke QA spec
5. Runbook set
6. Implementation backlog

---

## 13. 세부 실행 로드맵

### Track A. Sentry 기반 Observability 구축

#### A-1. 프로젝트 구조 결정

목표: 이벤트가 섞이지 않게 수집 경계를 먼저 정한다.

권장안:

- Sentry Project 1: `workdeck-web`
- Sentry Project 2: `workdeck-worker`
- Sentry Project 3: `workdeck-batch` 또는 `workdeck-scheduler`

대안은 단일 프로젝트 + service tag입니다.
하지만 제 판단은 분리 쪽이 낫습니다.

이유:

- web runtime error와 worker batch failure는 triage 주체가 다름
- alert 민감도도 다름
- issue noise 분리가 쉬움

결론:

- 초기에 운영 단순성을 원하면 1 project + `service` tag도 가능
- 다만 Workdeck처럼 자동화 배치 비중이 높으면 최소 web / worker는 분리 권장

#### A-2. 공통 태그 표준

모든 이벤트에 아래 필드를 넣습니다.

필수 tags:

- `service`: web | api | worker | scheduler
- `env`: local | preview | production
- `workspaceId`
- `runType`: ad-collection | inventory-collection | analysis | slack-notify | scheduler
- `scheduleId`
- `triggeredBy`: cron | manual | webhook | post-collection
- `release`

권장 extras/context:

- `reportDate`
- `storeName`
- `jobStartedAt`
- `attempt`
- `durationMs`
- `expectedRows`
- `insertedRows`
- `skippedReason`
- `externalTarget`: coupang-wing | slack | openai/openrouter | db

이 표준이 없으면 나중에 "로그는 있는데 운영 판단이 안 되는" 상태가 됩니다.

#### A-3. 에러 레벨 기준

- `fatal`: worker process crash, scheduler process stop
- `error`: collection 실패, analysis 실패, API 5xx, Slack 발송 실패
- `warning`: selector fallback, env 누락으로 기능 스킵, insertedRows 0, repeated retry
- `info`: 정상 스킵, 수동 실행, 배포 후 smoke pass

중요한 판단은 이것입니다.
_Slack 발송 실패와 analysis trigger 실패는 warning이 아니라 error입니다._
운영 목적상 실제 사용자 영향이 있기 때문입니다.

---

### Track B. 이벤트 taxonomy 정의

#### B-1. 이벤트 네이밍 규칙

권장 포맷:
`domain.action.result`

예시:

- `ad_collection.start`
- `ad_collection.success`
- `ad_collection.failed`
- `inventory_collection.start`
- `inventory_collection.failed`
- `analysis.trigger.success`
- `analysis.trigger.skipped`
- `slack_notification.failed`
- `scheduler.tick.success`
- `scheduler.tick.skipped`
- `external_ui.selector_fallback`

이름을 초기에 고정해야 대시보드와 alert rule이 안 흔들립니다.

#### B-2. 도메인별 기록 기준

_광고 수집_

- 시작 시 message/breadcrumb
- 다운로드 실패 시 exception
- 업로드 row 수 0이면 warning
- 완료 시 success event

_재고 수집_

- Wing 로그인 성공/실패 breadcrumb
- 좌측 메뉴 탐색 실패 error
- 재고현황 진입 실패 error
- 엑셀 다운로드 버튼 탐색 실패 error
- 다운로드 파일 없음 error
- 업로드 결과 0건 warning

_분석_

- 분석 트리거 시작/성공/실패
- interval 미도달은 info
- prerequisite missing은 warning
- LLM/provider fail은 error

_Slack 발송_

- token/channel env 없음 warning 이상
- Slack API 응답 실패 error
- retry 후 최종 실패 error
- 성공 시 success

_Scheduler_

- tick 자체가 실행됐는지 heartbeat event 남김
- 연속 2회 tick 없음이면 alert 대상

---

### Track C. Alert 정책 구체화

#### C-1. 즉시 페이지 수준

바로 사람을 깨워야 하는 항목입니다.

- production worker crash
- production scheduler crash
- production collection failure 연속 2회
- production inventory failure 연속 2회
- production Slack notification failure
- production API 5xx burst

#### C-2. 즉시 알림이지만 페이지는 아님

- preview smoke QA failure
- production selector fallback 급증
- insertedRows 0 반복
- analysis skipped 반복

#### C-3. 일일 점검 수준

- preview JS runtime error
- 일시적 timeout 1회
- 이미 확인된 외부 서비스 불안정

#### C-4. 추천 임계값

- worker crash: 1회 즉시
- scheduler tick missing: 2 interval 연속
- ad/inventory collection fail: 동일 workspace 2회 연속
- Slack notification fail: 1회 즉시
- API 5xx: 10분 내 10건 이상
- smoke failure: 배포당 1회 즉시

노이즈를 줄이려면 "개별 exception" 기준이 아니라 "운영 의미" 기준으로 룰을 걸어야 합니다.

---

### Track D. Playwright smoke QA 설계

#### D-1. smoke QA 목표

테스트의 목적은 상세 회귀 검출이 아닙니다.
배포 직후 "운영이 깨졌는지 아닌지"를 빠르게 판단하는 것입니다.

따라서 smoke는 짧고 결정적이어야 합니다.

#### D-2. 1차 smoke 시나리오

_웹 smoke_

1. 로그인 페이지 접근 가능
2. 인증 후 대시보드 진입 가능
3. 광고 데이터 페이지 렌더 성공
4. 재고 데이터 페이지 렌더 성공
5. 분석 리포트 리스트 렌더 성공
6. 설정 페이지에서 핵심 연결 정보 조회 가능

_API smoke_

1. health endpoint 응답
2. 최근 report 조회 endpoint 응답
3. scheduler status endpoint 또는 내부 상태 조회 가능

_worker synthetic smoke_

1. 외부 사이트 로그인 페이지 접근 가능
2. 핵심 locator 존재 확인
3. read-only 모드로 다운로드 버튼 가시성 확인

#### D-3. smoke 운영 원칙

- preview: 배포마다 필수 실행
- production: read-only smoke만 실행
- destructive action 금지
- 실패 시 CI fail + Slack + Sentry 동시 기록

#### D-4. Playwright와 Sentry 연결 방식

Playwright 실패를 CI 로그에만 남기면 약합니다.
다음이 같이 가야 합니다.

- 실패 screenshot 첨부
- trace 저장
- failure summary를 Sentry event로 업로드
- release와 연동

그래야 "이 배포 이후 smoke가 깨졌다"가 운영 이슈와 연결됩니다.

---

### Track E. Runbook 구체화

최소한 아래 5개는 바로 있어야 합니다.

#### E-1. `worker-failure-response.md`

포함 내용:

- 증상
- 확인 명령
- 최근 release 확인
- env 확인 포인트
- 외부 인증 실패 여부 확인
- 재실행 기준
- 롤백 기준

#### E-2. `slack-notification-failure.md`

포함 내용:

- token/channel/env 확인
- Slack API response 확인
- fallback 알림 채널 여부
- 재전송 기준

#### E-3. `external-ui-selector-breakage.md`

포함 내용:

- Playwright trace 확인
- selector fallback 경로
- locator 우선순위 규칙
- hotfix 범위

#### E-4. `analysis-pipeline-failure.md`

포함 내용:

- 수집 성공 여부
- prerequisite 데이터 존재 여부
- provider timeout 여부
- 재실행 순서

#### E-5. `scheduler-heartbeat-missing.md`

포함 내용:

- scheduler 프로세스 확인
- cron/deploy/job runner 확인
- 최근 tick event 확인
- 복구 후 검증 절차

---

## 14. 실제 구현 체크리스트

### Step 1. 사전 설계

- [ ] Sentry 프로젝트 구조 결정
- [ ] DSN / env / release 변수 설계
- [ ] 이벤트 taxonomy 합의
- [ ] severity 기준 확정
- [ ] PII 마스킹 정책 정의

### Step 2. web/api 연동

- [ ] `@sentry/nextjs` 설치
- [ ] App Router 연동
- [ ] API route 예외 수집
- [ ] user/workspace context 연결
- [ ] release/source map 설정

### Step 3. worker 연동

- [ ] `@sentry/node` 설치
- [ ] process-level handler 추가
- [ ] job scope 표준화
- [ ] runId/workspaceId tagging
- [ ] 수집/분석/Slack 발송 이벤트 추가

### Step 4. scheduler 연동

- [ ] tick heartbeat 기록
- [ ] skipped reason 표준화
- [ ] 연속 미실행 감지 룰 연결

### Step 5. alert 연결

- [ ] Slack alert channel 연결
- [ ] high severity 룰 우선 적용
- [ ] digest 룰 분리
- [ ] noise tuning

### Step 6. smoke QA 구축

- [ ] preview smoke suite 작성
- [ ] CI에 smoke job 추가
- [ ] screenshot/trace artifact 저장
- [ ] failure -> Sentry event 업로드

### Step 7. runbook 정리

- [ ] 장애 유형별 문서 작성
- [ ] alert 메시지에 runbook 링크 삽입
- [ ] 담당자 대응 순서 명시

---

## 15. 권장 일정

### Week 1

- Sentry 구조 확정
- web/api/worker 기본 SDK 도입
- 핵심 이벤트 계측 1차 반영
- high alert 최소 세트 연결

### Week 2

- scheduler heartbeat
- Playwright preview smoke 구축
- release 연동
- runbook 1차 작성

### Week 3

- 운영 noise 조정
- synthetic read-only check 추가
- dashboard / saved search 정리
- known issue fingerprint 조정

이 순서가 맞습니다.
처음부터 완벽하게 넓게 가면 실패합니다.
먼저 P0 경로를 좁고 깊게 계측해야 합니다.

---

## 16. 구현 백로그 제안

Epic 1. Observability Foundation

- Sentry SDK bootstrap for Next.js
- Sentry SDK bootstrap for worker
- Release tagging and environment separation
- PII scrubber

Epic 2. Domain Event Instrumentation

- Ad collection instrumentation
- Inventory collection instrumentation
- Analysis pipeline instrumentation
- Slack notifier instrumentation
- Scheduler heartbeat instrumentation

Epic 3. Alerting

- High severity alert rules
- Medium severity digest rules
- Slack routing separation

Epic 4. QA Automation

- Preview smoke suite
- Production read-only synthetic suite
- Artifact and trace retention
- Sentry integration for smoke failure

Epic 5. Operations

- Worker failure runbook
- Selector breakage runbook
- Slack failure runbook
- Analysis failure runbook

---

## 17. 제안하는 바로 다음 액션

에디, 다음은 3개로 바로 끊으면 됩니다.

1. _문서 확정_

- 이 계획을 master plan으로 승인

2. _P0 구현 태스크 분해_

- 실제 코드 기준으로 파일 단위 작업 목록 작성
- 예: `sentry.server.config`, `worker bootstrap`, `scheduler instrumentation`, `slack notifier wrapper`

3. _실행 착수_

- 우선 `web/api + worker + slack notifier` 3곳부터 붙임

제 추천은 2번까지 제가 바로 이어서 하는 겁니다.
즉, 다음 문서로
_Workdeck 실제 코드 기준 Sentry 적용 태스크 리스트_
까지 바로 뽑는 게 맞습니다.
