# 체험 중 구독 예약 + 구독·해지·추가·중지 흐름 정리

작성: 2026-11-15. 브랜치 `feat/trial-subscribe-flow` (origin/develop `c9de5c82` 기준).

## 목표 (사용자 보고 4건 + grill 확정)

1. 체험 중에도 바로 구독. **결제는 체험 종료일**, 유료 기간도 그날부터.
   - 활성 구독 없음: 지금 0원, 결제일(`currentPeriodEnd`) = 선택 업무 중 가장 빠른 체험 종료일. 그날 기존 정기결제 cron 이 한 달치 결제.
   - 활성 구독 있음: 체험 종료일에 그날~다음 정기 결제일 **일할 결제**(기존 업무 추가 규칙), 이후 합산 정기결제.
   - 실패 시 기존 정기결제와 같은 재시도(1·3·5일) 동안 계속 사용, 소진 시 잠금. 일할 예약 결제 실패는 **그 업무만** 재시도·종료.
   - 체험 종료 전 해지 = 예약 취소, 0원, 즉시 종료(체험은 남은 기간 그대로).
   - 내 워크덱: 유료 구독 안 한 사용 중 업무(TRIAL·PAUSED·GRACE)에 소유자용 「구독하기」.
2. 체험 D-Day: 「체험 중」 옆 항상 `D-n`(마지막 날 `D-Day`), D-3~D-Day 주황 강조 + 「체험 종료 임박」. 예약 업무는 「D-n 후 유료 전환」. 두 화면 동일 헬퍼.
3. 구독 업무 관리 「구독」 → 바로 확인 모달(카드 없으면 기존 카드 등록 팝업). 장바구니·하단 「구독 시작」 카드 제거.
4. 「빼기」 버튼은 3번으로 제거됨.

## 흐름별 점검 결과

| 흐름 | 화면 | 현재 동작 | 문제 | 조치 |
|---|---|---|---|---|
| 구독 시작 | 설정 | 카드 있으면 「구독」=장바구니 토글, 하단 「구독 시작」 다시 클릭 | #3, 「빼기」 어색(#4) | 클릭 → 확인 모달 직행, 장바구니 제거 |
| 구독 시작 | 설정 | `confirmPending` → `runStartSubscription()` 이 `pending.decks` 가 아닌 `selectedDecks` 상태를 읽음 | 장바구니 제거 시 깨짐 | 모달 대상 deck id 를 인자로 전달 |
| 구독 시작 | 내 워크덱 | LOCKED 업무에만 「구독하고 이용하기」 | 체험 중 구독 불가(#1) | TRIAL·GRACE 에도 「구독하기」, PAUSED 는 비활성+「결제 준비 중」 안내(어차피 503) |
| 체험 중 구독 | 서버 | start=즉시 전액, add=즉시 일할 | 체험 남은 기간에 돈이 나감(#1) | 예약 구독 (아래 설계) |
| 업무 추가 | 설정 | 「추가」 `disabled={!method}`, 카드 등록 경로 없음 | 카드 없을 때 막다른 길 | 「구독」과 같이 카드 등록 팝업 경유 |
| 해지 | 설정 | 「해지」 즉시 실행, 확인 없음 | 오클릭 위험, 내 워크덱과 불일치 | 확인 다이얼로그 추가(내 워크덱 문구 재사용) |
| 해지 | 내 워크덱 | 확인 후 해지 | 예약 업무도 「구독 해지」/「…까지 이용」 문구 | 예약이면 「구독 예약 취소」·「결제 없이 취소, 체험은 {종료일}까지」 |
| 다시 시작 | 설정 | CANCEL_AT_PERIOD_END → 「다시 시작」(추가 결제 없음) | 이상 없음 | 유지 |
| 사용 중지 | 내 워크덱 | 미구독 업무 목록에서 내림 | 이상 없음(체험 시계는 계속) | 유지, 확인 문구에 체험 종료일 병기 |
| 체험 표시 | 두 화면 | 「체험 종료일: 날짜 (KST)」 | 종료 임박 인지 어려움(#2) | D-Day 배지 |
| 결제일 요약 | 설정 | `nextCycleSupplyTotal` 로 「다음 결제일 · 월 X」 | 0원 예약 구독에서 늦은 예약까지 합산 | 결제일에 실제 청구될 아이템만 합산, 이후 예약은 따로 표기 |

## 설계

### 스키마 (`prisma migrate dev --name subscription_item_trial_reservation`)

`SubscriptionItem` 에 추가(기존 행 영향 없음):

- `awaitingTrialEnd Boolean @default(false)` — 체험 중 예약되어 아직 결제 전인 아이템.
- `billingRetryCount Int @default(0)` — 일할 예약 결제 실패 횟수(구독 단위 `retryCount` 와 분리).

**결제 시작일은 저장하지 않고 `SpaceDeckAccess.trialEndsAt` 에서 매번 파생**한다. 체험 종료일을 쓰는 곳이 어드민 API 외에 `scripts/billing-admin.mjs`(`set-trial`·`trial-all`·`migrate-grant`, SQL 직접 UPDATE)까지 여럿이라, 날짜를 복사해 두면 연장 시 체험 중 결제가 생긴다. 파생이면 어떤 경로로 연장돼도 자동으로 따라간다.

### 서비스 (`src/lib/billing/subscription-service.ts`)

`paidStartOf(item, access)` = 예약 아이템이면 **항상 실제 `trialEndsAt`**(체험 종료 후에도 고정, `now` 로 흐르지 않음 — 분류·orderId 가 날마다 바뀌지 않게). `trialEndsAt` 이 null 이면(데이터 이상) 아이템 `addedAt`. 서버 값만 사용.

- `startSubscription(deckIds)`: 체험 중(서버 판정) 업무 = 예약군, 나머지 = 즉시군.
  - 즉시군 ≥1: 기존대로 즉시군 전액 결제, `currentPeriodEnd = now+1개월`. 예약군은 ACTIVE + `awaitingTrialEnd=true`.
  - 즉시군 0: 결제 없이 `status=ACTIVE`, `currentPeriodEnd = min(체험 종료일)`, 전부 `awaitingTrialEnd=true`.
  - `assertCheckoutOpen`, 보장가(`lockedPrice`) 유지 로직 그대로.
- `addDeck`: 대상이 체험 중이면 결제 없이 ACTIVE + `awaitingTrialEnd=true`. 그 외 기존.
  - (Codex P1) 결제된 아이템이 없는 예약 전용 구독이면 일할 경로 대신 시작 규칙 적용: 체험 업무 → `currentPeriodEnd = min(전체 예약 시작일)` 재계산, 즉시 업무 → 한 달 전액 결제 + `currentPeriodEnd = now+1개월`(그보다 이른 예약은 일할, 늦은 예약은 유지). 공통 함수로 start 와 공유.
- `cancelDeck`: 예약 아이템(`awaitingTrialEnd`)이면
  - 체험 종료 전(`trialEndsAt > now`, 결제 시도 전): 즉시 ENDED, **`lockedPrice` 유지**(결제 이력 없음 — 사용자 확정), 응답 `{ effectiveAt: null, reservationCanceled: true }`.
  - 체험 종료 후(결제 시도됐을 수 있음): 먼저 관련 일할 청구를 `reconcilePending` 으로 확인. 승인 → 결제된 아이템으로 확정 후 기존 해지(CANCEL_AT_PERIOD_END). 실패/청구 없음 → 0원 ENDED. 불명 → 409 「결제 확인 중」. 조건부 update 로 cron 과 경합 방지.
  - 취소 후 결제된 아이템(`awaitingTrialEnd=false`, 비-ENDED)이 하나도 없으면: 남은 아이템 0 → 구독 `CANCELED`, `currentPeriodEnd=null`. 예약만 남음 → `currentPeriodEnd = min(남은 예약의 체험 종료일)`. 조건부 update + 트랜잭션.
- cron 순서: `runReservedStarts` → `runDueCharges`.
- `runReservedStarts(now)` (일할 예약 결제):
  - 대상: 구독 ACTIVE/PAST_DUE, 아이템 ACTIVE+`awaitingTrialEnd`, 파생 시작일 `<= now` 이고 `< currentPeriodEnd`.
  - 시작일~`currentPeriodEnd` 일할. orderId 는 아이템+시작일 기준 멱등, 첫 시도에서 청구 행에 기간·금액 고정 → 재시도는 같은 청구 행 재사용(`reconcilePending`·`createOrReclaimCharge` 재사용).
  - 성공 → `awaitingTrialEnd=false, billingRetryCount=0`. 실패 → `billingRetryCount+1`, `RETRY_OFFSETS_DAYS` 기준 재시도. 구독 `retryCount`·PAST_DUE 는 건드리지 않음. 소진 시 아이템 ENDED(보장가 유지 — 기존 "결제 실패 만료는 보장가 유지").
- `runDueCharges` (미납 일할과 새 주기 분리):
  - 결제된 아이템, 또는 파생 시작일 `<= currentPeriodEnd`(timestamp 정확 비교 — 결제일을 `min(trialEndsAt)` 그대로 잡으므로 같은 값) 중 일할 대상이 아닌 예약 → 정기결제 합산, 성공 시 `awaitingTrialEnd=false`. 시작일이 결제일보다 1ms 라도 늦으면 예약 유지.
  - 파생 시작일 `> currentPeriodEnd` 예약 → 제외·유지.
  - 파생 시작일 `< currentPeriodEnd` 인데 아직 예약 = 일할 미납 → **새 주기 정기결제에 합산**(아이템 한 달치 + 미납 일할 줄을 breakdown 에 별도 기재). 합산 전 단독 일할 청구 행이 `PENDING`(결과 불명)이면 기존 `reconcilePending` 으로 PG 조회: 승인 확인 → 그 청구를 PAID 로 확정하고 합산하지 않음 / 실패 확인 → 행을 닫고 합산 / 여전히 불명 → **그 구독의 이번 정기결제 전체를 보류**(주기 진행 안 함)하고 다음 cron 에서 다시 확인. 아이템만 빼고 주기를 넘기면 새 주기 한 달치가 미청구로 사라지므로. 성공 시 `awaitingTrialEnd=false`. 실패 시 기존 구독 dunning(1·3·5일, 그동안 사용 유지) — 같은 카드라 따로 재시도할 실익이 없고, 미납도 사라지지 않음.
  - 합산 대상 0 + 결제된 아이템 0 + 예약만 남음(체험이 연장된 경우) → 결제 없이 `currentPeriodEnd = min(예약 시작일)` 로 재설정. **체험 연장이 어떤 경로로 일어나도 자가 보정.**
  - 즉시군 0 구독의 첫 결제 실패 → 기존 PAST_DUE dunning.

### 웹훅 환불 동기화 (#1416 경로)

- 혼합 시작의 즉시군 청구가 전액 취소되면: 해당 청구 breakdown 아이템만 종료, 예약 아이템은 유지. 결제된 아이템이 0이 되면 위 「예약만 남음」 규칙으로 결제일 재계산.
- 일할 예약 청구 전액 취소: 그 아이템만 ENDED.
- 테스트로 고정.

### 엔타이틀먼트·어드민

- 판정 변경 없음(예약 아이템도 SUBSCRIBED → 체험 종료 후 끊김 없음).
- overview API·`resolveEntitlement`·my-deck page 에 `awaitingTrialEnd` 전달.
- 어드민 구독 현황(`subscription-admin.ts`, `subscriptions-client.tsx`): 예약 아이템을 「구독 예약」으로 표기, 결제 완료 집계에서 제외.

### UI

- `billing-shared.ts`: `trialDday(trialEndsAt, now)` → `{ label, urgent }`. `formatTrialEndDate` 와 같은 KST 날짜로 계산(배지와 종료일 표기 일치). 테스트: KST 자정 경계, `-0`(#1312), 종료 당일 D-Day.
- `subscription-settings-client.tsx`: 장바구니 제거, 「구독」→ 모달, 「추가」 카드 없을 때 등록 팝업, 「해지」 확인 다이얼로그, D-Day, 예약 표기·「예약 취소」, 결제일 요약 보정.
- `subscribe-dialog.tsx`: 체험 중 업무면 「오늘 결제 0원 · {종료일}부터 유료(그날 결제)」, 버튼 「구독 예약」. 일할 금액은 결제일에 계산된다고 표기.
- `my-deck-client.tsx` + `app/my-deck/page.tsx`: 「구독하기」(소유자, TRIAL·GRACE 활성 / PAUSED 비활성+안내), D-Day, 예약 취소 문구.

## 단계 (TDD)

1. 스키마 + migration(로컬 DB).
2. `trialDday` 단위 테스트 → 구현.
3. 서비스 e2e(로컬 DB, PG mock) 실패 테스트 먼저: 체험 중 start 0원·결제일 / 혼합 start / 활성 구독에 체험 업무 add / 예약 전용 구독에 더 이른 체험·즉시 업무 add / 예약 취소 0원·lockedPrice 유지·마지막 예약 취소 CANCELED·결제일 재계산 / runReservedStarts 성공·실패 재시도·소진 / runDueCharges 포함·제외·미납 합산(정기결제 하루 전 첫 실패 케이스)·체험 종료 다음 날 cron 시작일 고정·체험 연장 자가 보정(`billing-admin` SQL 경로 포함) / 이중 실행 멱등 / 일할 PENDING 불명 상태에서 정기결제일 도래 / 같은 날 더 늦은 체험 종료 시각 / 체험 종료 후 예약 취소(승인·실패·불명) / 웹훅 환불 2건.
4. 서비스·웹훅·어드민 구현.
5. UI 테스트 → 구현.
6. lint, 관련 테스트, Vercel preview 빌드.
7. 독립 코드 리뷰 → develop PR → main 릴리스 PR.

## 검증

### 실행 결과 (2026-11-15)

- 로컬 전용 DB(127.0.0.1:55471/deck_trials, PG mock) 결제 e2e 65/65 — `--runInBand` 2회. 신규 `trial-reservation.e2e` 19건, 환불 웹훅 혼합 환불 1건 포함. 기존 `locked-price` 는 체험 중 즉시 결제를 전제했던 부여 날짜만 「체험 종료 상태」로 바꿔 원래 검증(보장가·재시도)을 유지.
- 결제 e2e 는 공유 DB 에서 `runDueCharges` 가 모든 구독을 처리하므로 **병렬 실행 시 suite 간 간섭** → `--runInBand` 로 실행한다.
- 단위·UI: billing·my-deck·overview·webhook 124/124. 전체 jest 실패 6 suite(worker naver·period-confirm·verify-downloaded-file, use-user.server, sh nbaesong settings)는 origin/develop 에서도 동일 실패(기존).
- `tsc --noEmit` 통과, 변경 파일 eslint 오류 0, migration RLS lint 11/11.
- migration 은 스키마 diff 로 생성. 로컬 DB 는 baseline 구성이라 `migrate dev` 이력이 맞지 않아 같은 SQL 을 로컬 전용 DB 에만 `db execute` 로 적용(원격 DB 미접촉). 운영 반영은 배포의 `migrate deploy`.
- Codex 코드 리뷰: P1 2건(예약 취소↔cron 일할 청구 경합, 이미 PAID 인 일할 청구 누락) → Space 행 잠금 아래 재확인 + 청구 생성 가드로 반영, 테스트 2건 추가.

### 계획

- 단위·UI·로컬 DB e2e 결과 보고(로컬 typecheck/build 미실행 시 명시).
- preview 에서 허용 공간 계정으로 화면 확인. 운영 실결제 없음.
- 배포 후 cron 실행 결과에서 `runReservedStarts` 0건 정상 종료 확인.

## 위험·운영

- prod `BILLING_CHECKOUT_PAUSED=1` 유지 → 허용 공간 외에는 기존처럼 결제 준비 중.
- 0원 ACTIVE 구독 발생 → 어드민 집계 보정(위).
- 일할 예약 결제는 cron 1일 1회라 최대 하루 늦게 결제(접근은 끊김 없음).

## 롤백

- 코드 revert. 컬럼은 기본값이 있어 남겨도 무해(후속 migration 으로 제거).
- revert 전 `awaitingTrialEnd=true` 아이템 **전체**(미래 예약 + 재시도 중 미납)와 관련 청구 행 상태를 READ ONLY 로 추출. 구 코드는 이들을 결제 완료 아이템으로 보고 미래 예약은 정기결제일에 청구, 미납 일할은 누락하므로 고객별 처리 방침 결정 후 진행.

## 리뷰 반영

Codex 리뷰: 지적 10건(5회 검토) — 반영 10, 보류 0.
- P1 미납 일할이 정기결제에 묻힘 → cron 순서 고정 + 미납 일할은 정기결제일에 ENDED.
- P1 마지막 예약 취소 후 구독 ACTIVE 잔존 → CANCELED 또는 결제일 재계산.
- P2 롤백 조사 범위 → 예약 아이템 전체.
- P1 체험 종료 후 시작일이 now 로 흐름 → 실제 trialEndsAt 고정.
- P1 정기결제일 직전 실패 시 재시도 보장 못 함 → 미납 일할을 새 주기 결제에 합산, 기존 dunning 적용(1차의 「미납 ENDED」 대체).
- P1 예약 전용 구독에 업무 추가 시 결제일 미갱신 → 시작 규칙 공유·결제일 재계산.
- P1 PG 결과 불명 일할 청구를 합산하면 이중 청구 → 합산 전 PG 조회, 불명이면 보류.
- P1 같은 날짜 비교로 체험 종료 전 청구 → timestamp 정확 비교.
- P1 불명 청구 아이템만 빼고 주기 진행 시 미청구 → 구독 정기결제 전체 보류.
- P1 체험 종료 후 예약 취소 중 결제 승인 → 취소 전 PG 확인, 불명이면 409.

Advisor 추가 반영: 체험 종료일 쓰는 곳 여러 개 → 날짜 저장 대신 파생+자가 보정, 예약 취소 시 보장가 유지, 흐름별 점검 표, 웹훅 환불·D-Day 경계 테스트, 어드민 0원 ACTIVE 표기.
