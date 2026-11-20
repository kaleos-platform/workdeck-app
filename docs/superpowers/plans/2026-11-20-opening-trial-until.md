# 오프닝 이전 고객 체험 = 오프닝 이용 종료일 + 7일

작성: 2026-11-20. 브랜치 `feat/opening-trial-until` (origin/develop).

## 목표 (사용자 결정 11-20)

오프닝워크에서 이전한 고객의 워크덱 모집 관리 무료 체험을 **오프닝 이용 종료일(KST 날짜) + 7일까지**로 바꾼다.

- 이미 이전한 고객 + 앞으로 이전할 고객 모두.
- 이미 체험이 끝나 잠긴 고객도 연장해서 다시 연다.
- 고객 안내 메일은 보내지 않는다(화면의 종료일·D-Day 로 충분).

## 데이터 출처 (11-20 READ ONLY 조회, 사용자 명시 지시)

- 워크덱 `OpeningMigrationJob.openingBrandId ↔ targetSpaceId` (status DONE 7건, 의식주의 134 는 내부·BLOCKED 라 제외).
- 오프닝 `pay_subscription` (`space_id` = brand.id) 중 가장 최근 구독(PENDING_CANCEL/CANCELED)의 `current_period_end_at`(=end_date). 값은 UTC 기준 timestamp without time zone → `::text` 로 읽고 +9h 해서 KST 날짜.

대상 7곳(구독 예약 고객 1곳 포함)의 고객별 대응표는 운영 기록 `~/.local/share/workdeck/opening-migrations/trial-extension-2026-11-20/README.md` 에 둔다(고객 식별 정보라 Git 제외).

## 단계 (Codex 비판 검토 반영 후)

### 핵심 변경: 수동 날짜·Space 입력 제거 → `opening-trial` 명령

`node scripts/billing-admin.mjs opening-trial <brandId>|--all [--apply]` (기본 미리보기, `--apply` 때만 커밋)

- 입력은 오프닝 브랜드 번호뿐. Space 는 `OpeningMigrationJob(openingBrandId)` 의 `targetSpaceId`(상태 APPLIED·GRANTED·GRANT_MANUAL·HELD·DONE) 로만 찾는다 → 오지정 불가.
- 오프닝 종료일은 명령이 오프닝 DB(`OPENING_SOURCE_URL`, READ ONLY 세션)에서 직접 읽는다: 해당 brand `pay_subscription` 중 `current_period_end_at` 최신값(9999 영구값 제외). UTC 문자열 → KST 날짜 → +7일 → 종료 시각 = 그 다음 날 00:00 KST. 순수 함수로 분리해 경계(UTC 자정·월말·연말) 테스트.
- 워크덱 쪽 한 트랜잭션: `Space` 행 `FOR UPDATE`(결제 경로 `createOrReclaimCharge` 와 같은 잠금) → PENDING 청구 있으면 중단 → 모집 관리 구독 아이템 검사:
  - 결제된 아이템(비-ENDED·awaitingTrialEnd=false)이 있으면 중단(유료 고객은 대상 아님, 사람 판단).
  - 예약 전용 ACTIVE 구독이면 trialEndsAt 과 함께 `currentPeriodEnd` 도 새 종료 시각으로 옮긴다(`realignReservationOnly` 와 같은 규칙, retryCount 0·status ACTIVE). PAST_DUE 이면 중단.
  - **연장만**: 새 종료가 현재보다 늦을 때만 갱신. 이른 경우(이전이 늦어 오프닝+7 이 이미 지남)는 기본 7일 체험 유지(= max(기본, 오프닝+7)) — 잠금 방지 정책.
- 조건부 UPDATE(`trialEndsAt = 직전 값` 일 때만), 행 수 불일치 시 롤백.
- 출력: brand·Space·오프닝 종료(UTC 원값)·이전/새 trialEndsAt·결제일 이동 여부. `--apply` 결과는 운영 기록 폴더에 JSON 으로 저장(복구 기준).
- `--all` 미리보기 = 미처리 감지(대상 job 전체의 현재 vs 목표 대조) → 이전 런북의 마지막 단계로 고정. 앞으로 이전 시 `migrate-grant` 뒤 `opening-trial <brand> --apply` 필수, 주간 `--all` 미리보기로 누락 확인.

### A. 기존 이전 고객 6곳 (구독 예약 고객 제외)

`opening-trial --all` 미리보기 → 표와 대조 → 사용자 보고 → 각 brand `--apply`.

### B. 구독 예약 고객 1곳 — 사용자 어드민 「체험 연장」 2026-12-03 (11/21 09:00 KST 정기결제 전)

- 실행 직전 READ ONLY: 구독 ACTIVE·모집 관리 아이템 1개 awaitingTrialEnd=true·다른 결제 아이템 없음·PENDING 청구 없음(11-20 조회로 충족). 이 전제에서 어드민 경로가 결제일을 12/04 00:00 KST 로 옮긴다.
- 처리 후 READ ONLY 확인(trialEndsAt·currentPeriodEnd). 09:00 전 미처리·확인 실패 시: cron 결과(PAID 면 사용자와 환불 여부 결정) 확인.
- 대안: 코드 배포가 09:00 전에 끝나면 `opening-trial <brand> --apply` 로도 처리 가능(같은 규칙).

### 2차 비판 검토 반영 (추가 규칙)

- **결제일 = 모든 예약의 최솟값**: 예약 전용 구독이면 연장 후 비-ENDED 예약 아이템 전체의 체험 종료일(SpaceDeckAccess) 최솟값으로 `currentPeriodEnd` 를 다시 계산한다(모집 외 예약이 더 이르면 그 날짜 유지). 해지 예정(CANCEL_AT_PERIOD_END) 등 결제된 아이템이 있으면 중단.
- **정기결제 cron 시간대 회피**: cron(매일 00:00 UTC = 09:00 KST)의 면제 분기는 Space 잠금 없이 예약 플래그를 바꾸므로, 명령은 KST 08:50~09:30 에는 실행을 거부한다. (cron 자체 수정은 범위 밖 — 이전 고객은 면제가 아니어서 해당 분기를 타지 않음.)
- **감사 기록 원자성**: 같은 트랜잭션에서 `AdminAuditLog`(action `billing.deck.trial.opening`, targetType `spaceDeckAccess`, meta = brand·오프닝 종료 원값·이전/새 trialEndsAt·이전/새 currentPeriodEnd·실행 ID)를 남긴다. 복구 기준은 이 DB 기록, JSON 은 출력용.
- **향후 이전 자동화**: `migrate-grant` 가 같은 트랜잭션 안에서 이 연장을 함께 수행한다 — Space 의 `OpeningMigrationJob`(targetSpaceId) 브랜드로 오프닝 종료일을 조회. `OPENING_SOURCE_URL` 이 없거나 job 이 없으면 **실패**(조용히 7일로 남지 않음). 이전 고객 보장가 부여의 유일한 경로가 migrate-grant 이므로 누락이 생기지 않는다. `--all` 미리보기는 보조 점검.

## 변경 파일

- `scripts/billing-admin.mjs`: `opening-trial` 명령(오프닝 DB 선택 연결, KST 계산 함수, 잠금·검증 트랜잭션, 결과 기록)
- `scripts/__tests__/billing-admin.test.mjs`: 로컬 전용 DB 에 가짜 `brand`·`pay_subscription` 테이블로 — 매핑 검증, 연장만, 예약 전용 결제일 이동, 결제 아이템·PENDING·PAST_DUE 중단, 미리보기 무변경, 9999 제외
- 날짜 함수 단위 테스트(UTC 자정 직전·직후, 월말, 연말)

## 검증

- CLI·단위 테스트(로컬 55471/deck_trials), lint, 코드 리뷰.
- 운영: `--all` 미리보기 결과를 표와 대조해 보고 → 승인 → `--apply` → READ ONLY 사후 조회.

## 위험·롤백

- 연장만이라 고객에게 불리한 변화 없음. 매핑은 DB job 기준이라 오지정 없음.
- 복구: 저장된 결과 JSON 의 이전 값으로, 현재 값이 이번 실행 결과와 같을 때만 조건부 UPDATE(사용자 승인). 부분 실행은 brand 단위 트랜잭션이라 brand 별로 완료/미완료가 명확, 재실행은 연장만이라 멱등.
- 코드 revert 는 데이터 복구가 아님 — 위 절차로만 복구.

## 리뷰 반영

Codex 비판 검토: 지적 8건(1차 4·2차 4) — 반영 8, 보류 0.

- high Space 오지정·경합 → brand 입력·job 매핑·Space 잠금·조건부 UPDATE.
- high 예약 고객 결제일 이동 전제 → 실행 직전 전제 확인·실패 시 절차 명시.
- high 향후 고객 수동 입력 의존 → 종료일 자동 조회·`--all` 누락 감지·연장만(max) 정책 명시.
- medium 롤백 → 결과 JSON·조건부 복구·멱등 재실행.
- 2차 high 복수 예약 결제일 → 예약 전체 최솟값.
- 2차 high cron 무잠금 경합 → cron 시간대 실행 거부(이전 고객은 면제 분기 비대상).
- 2차 high 복구 기록 원자성 → 같은 트랜잭션 AdminAuditLog.
- 2차 medium 향후 누락 → migrate-grant 에 통합, 종료일 조회 실패 시 grant 자체 실패.
- 3차 high(보류) 구독 시작↔연장 동시 실행 시 옛 종료일로 결제일 저장 → 결제 시작일은 저장값이 아니라 매번 `SpaceDeckAccess.trialEndsAt` 에서 파생된다. 옛 결제일이 저장돼도 `runDueCharges` 가 「결제일보다 늦게 끝나는 예약」으로 분류해 결제 없이 결제일을 재정렬하고, 결제된 구독 중 예약은 `runReservedStarts` 가 파생 시작일 전에는 청구하지 않는다(`trial-reservation.e2e` 「체험이 연장되면(어떤 경로든) 결제하지 않고 결제일을 다시 맞춘다」로 고정). 연장된 체험 중 청구 경로가 없어 비차단. 같은 경합은 기존 어드민 체험 연장에도 있으며 같은 이유로 안전.
