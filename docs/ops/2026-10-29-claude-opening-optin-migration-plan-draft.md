# Opening → Workdeck opt-in 이전·결제·종료 — 실행 계획 (Claude Code)

- 작성: 2026-10-29 KST. 워크트리 `workdeck-app-opening-migration`, branch `feat/opening-optin-migration`(origin/main `48b837dd` 기준).
- 근거: `workdeck-app-admin/docs/ops/2026-10-29-claude-opening-migration-handoff.md`, 같은 폴더 `…-decision-update.md`, `…-direction-review.md`, `workdeck-app/docs/decks/recruiting/guides/migration-scope-policy.md`(10/29 구분).
- 이 문서는 계획이다. 운영 DB·결제·원본 설정은 변경하지 않았다. 아래 "읽기 점검"은 SELECT·코드 읽기만 했다.

## 0. 이번 점검으로 바뀐 사실

| 항목                        | 기존 문서                                         | 확인 결과 (2026-10-29)                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workdeck 라이브 결제        | "심사 중, 라이브 결제 불가 → 중복 청구 위험 없음" | prod `BillingCharge` PAID 4건(마지막 10/27)은 **테스트 키 승인**이다(prod env = `bill_workdst58` `test_*` 키, 10/28 이전엔 타 상점 test 키). 실제 출금 없음. 다만 라이브 키 교체 즉시 실과금되므로 이전 고객 청구 경로는 과금 가능한 상태로 다룬다. **추가 위험**: 테스트 발급 빌링키는 라이브에서 무효 → 교체 시 기존 ACTIVE 구독 갱신 실패. 키 교체 절차에 정리 단계 필요 |
| 덱 과금 모드                | —                                                 | 5개 덱 모두 `SUBSCRIPTION`, `paidActivatedAt` 2026-09-10. 모집 관리 정가 20,000원(공급가)                                                                                                                                                                                                                                                                                   |
| 기존 공간 유예              | GRACE 14일                                        | 상품 단위 `paidActivatedAt+14일` = 9/24 종료. 새 이전 고객 공간에는 유예가 없고 체험 14일(1회) 뒤 잠김                                                                                                                                                                                                                                                                      |
| 면제 범위                   | 모집 관리 무료                                    | `exemptFlag`는 공간 전체 — 전 덱 무료 + 공간 정기청구 전체 제외. 전 덱이 유료라 다른 덱까지 무료화된다                                                                                                                                                                                                                                                                      |
| Opening 신규 가입·결제 차단 | "즉시 중단"                                       | **코드에 스위치 없음.** 가입 `POST /api/members/signup`, 공간 생성 `POST /api/workspace/spaces`(14일 체험 자동), 결제 `POST /api/workspace/subscriptions/prepare`. 공간별 읽기 전용 수단도 없음                                                                                                                                                                             |
| StepPay 원장                | 대조 필요                                         | 일괄 조회 API 호출 코드 없음. 구독별 `GET /api/v1/subscriptions/{id}` 만. 로컬 미러 `pay_subscription`(status·next_payment_date·current_period_end_at)                                                                                                                                                                                                                      |
| 고객 Excel                  | 지원자 자료 보관                                  | 첨부 미포함. 첨부는 지원서 상세에서 1건씩, 1시간짜리 presigned URL 로만 받을 수 있다. 일괄/zip 없음                                                                                                                                                                                                                                                                         |
| 신규 이전 도구              | 12개월 상수 교체                                  | 공고 선정 코드 자체가 저장소에 없음(importer 는 공고 1건 packet 입력). 매장·직무·브랜드 생성 도구 없음(importer 는 대상 공간에 이미 있는 매장만 연결)                                                                                                                                                                                                                       |

## (a) 그대로 재사용

- 원장 `src/lib/hiring/migration/ledger.ts` — sourceRef·source/target hash 충돌 중단, 고객 수정 감지. 무차별 upsert 도입하지 않음.
- 파일 복사 `file-copy.ts` — sha256·크기 검증, 내용 주소 경로, `upsert:false`.
- 공고 importer `posting-import.ts` 의 DRAFT·알림 false 생성, 공간·매장 소속 검증, 이미지 경로 제한.
- CLI `scripts/import-opening-posting.mjs` 의 대상 환경 검증(`--expected-project-ref`·`MIGRATION_ENVIRONMENT`)과 plan-only 기본값, 고정 오류 코드 로그.
- 감사 스크립트 `audit-opening-*.mjs`(읽기 전용).
- 템플릿 importer: 로컬 tag `opening-template-importer-20261022`(`6094eca9`)의 `template-import.ts`·`import-opening-template.mjs`·테스트 — **코드 파일만** cherry-pick. tag 의 dry-run JSON·가이드 문서는 가져오지 않는다(고객 자료 가능성).
- 결제: 정기청구 `priceSnapshot` 사용(`subscription-service.ts:489`), 공급가 12,273 → 합계 13,500(`pricing.ts`), 해지 예약 취소 시 가격 유지(`addDeck` 의 CANCEL_AT_PERIOD_END→ACTIVE).
- Opening 쪽: 기존 `CancelSubscription`(END_OF_PERIOD + 제공자 재조회) 경로.

## (b) 최소 추가 구현

### B1. 신규 고객 선정·packet 준비기 (핵심 신규)

- 원본 DB 읽기 전용 트랜잭션으로 고객 1개 공간의 대상 산출: 공고 = 비삭제 AND (created_at ≥ C OR updated_at ≥ C), C = T 기준 12개월 전 00:00 KST(윤년 규칙은 기존 정책과 동일). 템플릿·매장·직무·브랜드는 활성 기준, 기간 무관.
- 출력: 공고별 PII 없는 packet + 고객 manifest(id·건수·사유 코드·이미지 sha256만).
- dry-run 이 기본. 집계: 포함/제외 사유별 건수, **updated_at 으로만 들어온 공고 수와 날짜 분포**(일괄 수정 군집 감지), 텍스트·scene 의 전화·이메일 패턴 적중 수, 수동 검수 필요 이미지 수.

### B2. 공고 importer 비PII 버전

- packet 스키마 allowlist + `.strict()`: `managerName`·`managerPhone`·`sourceMemberId`·`rawSnapshot`·`applicationEntries` 제거.
- `encryptPii`·`manager*` 컬럼 기록 제거, 작성자 매핑 제거.
- 본문 `manager` 섹션 차단(`posting-content.ts:70,219`).
- 원장 snapshot 을 명시 allowlist 객체로(`posting-import.ts:162`), `transformVersion: 'posting-v2'`. 기존 두 고객의 v1 기록은 그대로.
- 12개월 밖 packet 거부 가드(`OUT_OF_WINDOW`).

### B3. 매장·직무·브랜드 생성

- 기존 저장소에 없음. 공고 importer 가 요구하는 매장·직무를 원장 경유로 생성하는 최소 importer. 범위·필드는 B1 dry-run 결과로 확정.

### B4. 결제 — 이전 고객 할인·무료 기간 (`prisma/schema.prisma` 컬럼 1개 → (e) 조율)

- **면제(`exemptFlag`) 대신 `trialEndsAt` 사용**: 이전 고객 Space 의 `trialEndsAt = 결제 개시 안내일 + N일`을 운영 스크립트로 설정. 판정 4단계(`entitlement-core.ts:68`)가 허용하고, 정기청구는 ACTIVE 구독만 대상이라 청구 없음. 날짜 경과 시 자동 잠김 → 해제 작업·GRACE 재시작 문제·Space 전체 청구 제외 문제가 함께 사라진다. 자동 체험 평생 1회 가드(`entitlement.ts:126`)는 자동 부여에만 적용. `graceUntil` 컬럼 불필요.
- 상태: `SubscriptionItem.lockedPrice Int?`(보장 공급가 12,273). 할인 자격 표지가 없으면 실제 해지 후 재구독과 구분 불가라 필요.
- 이전 시 모집 관리 item 을 `lockedPrice` 와 함께 ENDED 로 미리 생성 → `startSubscription` 이 재활성화.
- `startSubscription`·`addDeck`: 잠긴 item 은 최초 청구(일할 포함)·snapshot 에 `lockedPrice` 사용.
- 실제 해지(ENDED/CANCELED 전환)에서 `lockedPrice` 해제 → 재구독 정가. 연체 만료(EXPIRED) 처리 여부는 사용자 결정.
- 다른 유료 덱 기존 사용 고객: 예외 설계 안 함(YAGNI). 신청 접수 때 확인만, 실제 나오면 그때 처리.
- 테스트: 잠긴 item 최초 청구 13,500·snapshot 유지, **`addDeck` 일할 청구에 `lockedPrice`**, 미잠금 정가, 해지 예약 취소 유지, 실제 해지 후 정가, `trialEndsAt` 연장 시 접근 허용·경과 시 잠김.

**B4 진행 (2026-10-29, `workdeck-app-opening-migration` / `feat/opening-optin-migration`, 로컬 커밋 `5f2636b6`, 미push)**

- `SubscriptionItem.lockedPrice` 마이그레이션 `20261029120000_subscription_item_locked_price`(ADD COLUMN 1개, dev DB 적용).
- `startSubscription`·`addDeck` 보장가 우선, 주기말 실제 해지 2곳에서 `lockedPrice = null`.
- CLI `billing-admin.mjs migrate-grant <spaceId> <무료종료일> [보장공급가]`: trialEndsAt(종료일 다음날 00:00 KST) + ENDED item 보장가, 모집 관리 이미 구독 중이면 거부·롤백. dev 스모크 확인.
- 리뷰 반영: 보장가 `Math.min(lockedPrice, 정가)`, 만료 후 재시작에서 고르지 않은 업무는 보장가 소멸, CLI `trialEndsAt` 은 기존보다 늦은 값 유지(GREATEST), CLI 세션 `SET TIME ZONE 'UTC'`.
- 알려진 동작(의도로 수용): ① `trialEndsAt` 은 Space 단위라 무료 기간엔 전 덱이 열린다(신규 가입 체험과 동일). ② 무료 기간 중 고객이 먼저 구독 시작하면 그 시점부터 결제·주기 시작(남은 무료일 소멸, 기존 체험과 동일) → 결제 개시 안내문에 명시. ③ 결제 실패 만료(EXPIRED)는 보장가 유지 — **사용자 확정(10/29)**.
- 테스트 `locked-price.e2e.test.ts` 7/7. 기존 `subscription-service.e2e` 3건 실패는 08월 가격 개정 이전 하드코딩 가격(사전 존재, 무관).

### B5. Opening 신규 가입·결제 차단 (Opening 저장소 — 배포 주체 확인 필요)

- `subscription_plan` 설정 비활성화로 막지 않는다 — 웹훅 검증이 같은 설정을 읽어 기존 구독의 취소·갱신·만료 반영까지 멈춘다(`callbacks.ts` `validateSubscription`).
- 최소안: `signup`·`spaces` 생성·`subscriptions/prepare` 3개 라우트에 차단 응답 + 안내 문구. 또는 StepPay 콘솔에서 상품/가격 판매 중지(가능 여부 확인 필요).

## (c) 지금 할 수 있는 읽기 점검

- [x] Workdeck prod 결제 상태·덱 과금 모드·면제 공간 수 (위 0절).
- [x] (10/29 실행, 결과 아래) Opening 원본 DB 읽기 전용: `pay_subscription` 유료 대상(활성 상태·`is_trial=false`·제공자 id 존재), 공간별 `next_payment_date`·`current_period_end_at`. 개인정보 컬럼(`pay_customer.email/name`)은 조회하지 않는다. 결과는 공간 id·상태·날짜만.
- [x] (10/29 실행, 결과 아래) B1 dry-run 1개 공간(대상 공간은 사용자 지정).
- [ ] 이전 신청 예정 고객의 Workdeck 기존 사용 여부(다른 유료 덱 구독) — 신청 접수 후.
- [ ] 첨부 직접 다운로드 경로 실측(지원서 상세 → 파일 URL) — 고지문 근거.

## (d) 사용자 결정·승인이 필요한 운영 행위

1. Opening 신규 가입·결제 차단 방식과 실행 주체(코드 차단 배포 / StepPay 콘솔 판매 중지).
2. StepPay 원장 접근 방법(콘솔 export / 운영 토큰으로 구독별 조회). 실제 취소(END_OF_PERIOD)는 고객별 대상·효과 확인 후 별도 승인.
3. 잔여 기간 환불 정책.
4. dry-run 대상 공간.
5. 면제 해제 후 유예 일수(N), 연체 만료 시 할인 유지 여부.
6. 구 지원 URL·이미지 유지 기간, Opening 백업 키 보관 주체.
7. 고지문·신청서 법률 검토(고지문에 첨부 미포함·1건씩 다운로드·기한 명시 필요).
8. 실제 적재·청구·링크 변경·서버 종료는 고객별 실행안으로 각각 승인.

### 2026-10-29 사용자 결정

- 가입·결제 차단: **코드로 3개 경로 차단**(가입·공간 생성·결제 시작). `subscription_plan` 설정은 건드리지 않는다. Opening 배포 주체는 확인 필요.
- StepPay 대조: **Opening 원본 DB `pay_subscription` 읽기 전용 집계(공간 id·상태·날짜만) → 사용자가 StepPay 콘솔과 대조.**
- dry-run 대상: **피크페이 공간**.
- 환불: **환불 없음, 이용기간 끝까지 이용.** 갱신만 END_OF_PERIOD 취소. 이용기간이 12/18 을 넘는 고객은 예외 목록으로 따로 보고.

## (e) 제품 기능 세션과 겹치는 파일

- `prisma/schema.prisma` — B4 컬럼 2개. 착수 전 범위·담당 기록 후 조율.
- `src/lib/hiring/opening-form-migration.ts`(migration 밖 공용, importer 가 호출) — 수정 필요 시 조율.
- `src/lib/billing/**`, `scripts/billing-admin.mjs` — 이 세션 담당.
- `src/lib/hiring/migration/**`, 이전 CLI·문서 — 이 세션 담당.
- `app/d/recruiting/**`, `app/api/hiring-*/**` — 손대지 않음.

## 완료 조건 (단계별 분리 보고)

- 데이터 복사됨 / 고객 이용 시작 / 유료 전환 / Opening 종료 — 각각 별도 단계.
- 고객별: 건수·관계·checksum·PII 0 검사·재실행 시 existing·고객 수정 충돌 중단 확인.
- 결제: 단위 테스트 + 테스트 환경 결제 증거. 운영 과금은 테스트를 대신하지 않는다.

## 2026-10-29 읽기 점검 결과 (Opening 원본, REPEATABLE READ READ ONLY)

접근: `aws --profile peak`(계정 023386846835) → S3 env 메모리 로드 → RDS SG 현재 IP /32 임시 규칙 → finally 회수, 잔여 workdeck 규칙 0 확인. 공간별 상세는 로컬 scratchpad `opening-subscriptions.json`(0600)만, Git·문서에 고객명 없음.

**구독**

- 공간별 최신 구독 기준 유료 ACTIVE **17곳, 전부 13,500원**, StepPay 구독 id 17/17 보유. 그중 1곳은 피크페이 자체 공간 → **외부 고객 16곳**(사용자 수치와 일치). 18/20은 과거 다른 기준.
- 전체 행: ACTIVE 17, CANCELED 49, EXPIRED 13(유료)+861(체험), TRIAL 1, UNPAID 1.
- 현재 이용기간 종료 최댓값 2026-11-28 → 12/18 넘는 공간 0.
- **다음 결제 예정일(KST)**: 10/29 1, 11/02 1, 11/10~11/28 15. 갱신을 그대로 두면 11월에 1회씩 더 청구되고, 11/19 이후 갱신분(약 9곳)은 이용기간이 12/18을 넘는다 → "환불 없음" 정책과 충돌. 갱신 중단 시점·종료일까지 접근 처리 결정 필요(사용자).

**피크페이 dry-run (C = 2025-10-29 00:00 KST)**

- 비삭제 공고 563 중 12개월 대상 3(전부 created 기준, updated만으로 들어온 0 → 일괄 수정 군집 없음).
- 활성 상세 템플릿 39, 매장 7, 직무 51.
- 대상 공고 행 JSON 전체에서 전화·이메일 패턴 0.
- 피크페이는 이미 이전한 기존 고객이라 쿼리 검증용. 신규 고객 dry-run은 신청 접수 후.

## 2026-10-29 갱신 중단 시점 검토 (사용자 지시: 갱신 후 이용기간이 12/18 이내면 허용, 넘으면 그 전에 중단)

규칙: 다음 결제일 D 에 갱신하면 이용기간 끝 = D + 1개월. **D ≤ 11/18 이면 허용, D ≥ 11/19 이면 중단.** 결제 시각은 최초 구독 시각을 따른다(로컬 미러 `next_payment_date`, KST).

| 다음 결제일(KST 시각)               | 갱신 | 이용 종료 |
| ----------------------------------- | ---- | --------- |
| 10/29 23:47                         | 허용 | 11/29     |
| 11/02 08:08                         | 허용 | 12/02     |
| 11/10 02:17                         | 허용 | 12/10     |
| 11/12 08:09                         | 허용 | 12/12     |
| 11/15 07:29 (피크페이 자체) · 02:50 | 허용 | 12/15     |
| 11/16 04:24 · 01:28                 | 허용 | 12/16     |
| 11/17 05:53                         | 허용 | 12/17     |
| 11/19 06:53                         | 중단 | 11/19     |
| 11/21 01:59                         | 중단 | 11/21     |
| 11/24 05:08                         | 중단 | 11/24     |
| 11/25 05:23 · 05:24                 | 중단 | 11/25     |
| 11/26 10:19                         | 중단 | 11/26     |
| 11/28 09:50 · 04:30                 | 중단 | 11/28     |

허용 9곳(피크페이 포함)도 11월 갱신 뒤 다음 결제일이 11/29~12/17 이라 결국 해지 예약이 필요하다. 그래서 **17곳 전체를 한 번에 END_OF_PERIOD 해지 예약하는 시점 = 11/17 05:53 갱신 성공 확인 후 ~ 11/19 06:53 전**, 권장 **11/18(수) 업무시간**.

- 이 한 번으로 중단 8곳의 11월 갱신과 허용 9곳의 12월 갱신이 함께 막힌다.
- 전제: 실행 전에 StepPay 콘솔이나 API로 구독별 다음 결제일·상태를 다시 대조한다(로컬 미러가 늦게 반영됐을 수 있음). 11/17 갱신 실패로 재시도 중인 고객도 같이 해지 예약한다.
- 영향: 중단 8곳은 11/19~11/28에 이용이 끝나 12/18보다 3~4주 이르다. 종료 고지에 고객별 종료일을 적고, 이용 종료 뒤에도 지원자 다운로드가 되는지 확인해야 한다(미확인). 이전 데이터는 원본 DB에서 직접 읽으므로 고객 이용 종료와 무관.
- 실행(StepPay 해지 호출)은 대상 목록 확정 후 별도 승인.

### 이용 종료 후 지원자 다운로드 (10/29 코드 확인)

- 서버: `GET /api/workspace/applications/download`는 `dwa_token`(JWT)만 검사하고 구독 상태는 보지 않는다. 다른 workspace API의 `verifyMember`도 구독을 검사하지 않는다. 구독 상태는 `pages` 응답으로 프론트에 전달된다.
- 프론트(웹) 소스는 로컬에 없어 화면 차단 여부는 미확인이다. 만료 메일 문구는 "다시 플랜을 신청하면 기존 공고와 지원자 정보를 그대로 이용"이라 화면 차단 가능성이 높다.
- 고지 반영: 다운로드 기한을 **고객별 이용 종료일**로 보수적으로 안내하고, 첨부파일은 엑셀에 포함되지 않는다고 명시했다(`2026-10-29-opening-shutdown-notice-draft.md`). 화면 확인으로 만료 후에도 받을 수 있으면 12/18로 늘린다.
- **화면 실측(10/29, 사용자 지시)**: 피크페이 공간 유료 구독(sub 179)을 운영 DB에서 잠시 `EXPIRED`·종료일 1분 전으로 바꾸고 Aside(u2)로 확인 → 상단 「서비스 이용 종료」, 플랜 화면 「작업공간 이용을 위해 플랜을 구독해주세요.」, **「지원자 관리」 메뉴 이동 불가 → 목록·엑셀·첨부 다운로드 모두 접근 불가**. 같은 실행의 finally에서 원래 값으로 원복(1건, 값 일치 확인), StepPay 미접촉, 임시 RDS 규칙 회수·잔여 0.
- 결론: **고객의 지원자 자료 확보 기한 = 고객별 이용 종료일**(중단 8곳은 11/19~11/28). 고지문에 반영 완료.

## 2026-10-29 B5 Opening 신규 가입·결제 차단 — 구현(미커밋·미배포)

- 배포 경로: `peakpay/opening_api` **main push = 운영 배포**(GitHub Actions `prod.yml` → ECR `opening/opening_api` → ECS `OpEcsProd-ApiProdService…`, 2 tasks). 현재 운영 이미지 = main HEAD `1be7d5f`(로컬 `opening-ref` 와 동일). 웹 프론트는 별도 ECS 서비스(소스 로컬 없음). 이 세션 gh 계정은 Actions 조회 404(권한 없음), git SSH fetch 는 됨.
- 로컬 브랜치 `chore/service-closing-block`(opening-ref, push 안 함):
  - `POST /api/members/signup`: 초대 토큰(`invitation_token`/`jrt_token`) 없는 가입 → 403 `ERR_SERVICE_CLOSING`. 기존 고객 직원 초대 가입은 유지.
  - `POST /api/workspace/spaces`(체험 자동 시작) → 403.
  - `POST /api/workspace/subscriptions/prepare`(신규 플랜 결제) → 403. 해지·재개(`cancel`/`reactivate`)·웹훅은 그대로.
  - `subscription_plan` 설정 미변경(웹훅 검증 보존).
- 검증: `yarn build`·eslint 통과. 운영 Dockerfile 로 로컬 이미지 빌드(Node 18) 후 inject 3건 통과(일반 가입 403, 초대 가입 미차단, 미인증 공간 생성·플랜 신청 거부). DB 필요한 기존 mocha 스위트는 저장소에 마이그레이션이 없어 미실행.
- 참고: 저장소에 `.dockerignore` 없음 → 로컬 `docker build .` 은 mac node_modules 를 덮어써 실패. CI(깨끗한 checkout)는 무관.
- 남은 결정: 배포 시점(고지 발송과 같은 날 권장), 배포 방법(main push 로 Actions — 시크릿 유효성 미확인 / 또는 `aws --profile peak` 로 ECR·ECS 수동).

## (나중) 오프닝 기존 리드 대상 종료 안내 + 워크덱 홍보 — 2026-10-30 추가

**대상**: 오프닝 도입 신청자. Webflow opening_beta 폼 누적 1,324건 → Make.com 웹훅 → 오프닝 API `create_join_request` → 오프닝 DB `join_request`. 이 중 미가입·이탈 리드가 대상이다(유료·체험 고객은 이미 종료 공지 대상).

**법적 전제 (먼저 확정)**

- 리드 개인정보는 피크페이가 "서비스 안내 및 이벤트 혜택 제공" 목적으로 수집했다. 이를 **의식주의에 넘기는 것은 제3자 제공**이라 별도 동의 없이는 할 수 없다.
- 그래서 **발신 주체는 피크페이**로 하고, 데이터는 피크페이 밖으로 내보내지 않는다. 내용은 "오프닝워크 종료 안내 + 대안 서비스(워크덱) 소개" 1회 발송으로 한다.
- 광고성 정보 발송 규정(정보통신망법 제50조)도 확인한다.
  - 수신 동의가 있는 건만 보낸다.
  - 제목에 `(광고)`를 표시한다.
  - 수신거부 방법을 넣는다.
  - 동의 시점이 2년을 넘은 건은 재동의 확인 대상인지 검토한다.
- 법률 검토 후 실행한다.

**실행안**

1. 대상 추출(읽기 전용, 건수만): `join_request`에서 다음을 제외한다.
   - 가입 완료자, 유료·체험 고객(종료 공지와 중복)
   - 반려(reject)된 건
   - 동의 체크가 없는 건
   - 이메일 중복
2. 메일은 피크페이 Mailgun(`noreply@opening.work`)으로 보낸다. 기존 `send_closing_notice` 워커 패턴을 복제해 `send_lead_sunset_notice`를 만들고, 기본은 dry-run으로 한다.
3. 링크는 `workdeck.work/recruiting?utm_source=opening&utm_medium=lead_email#apply`로 한다. 워크덱 쪽 데이터는 리드가 직접 신청서를 낼 때만 생긴다.
4. 성과는 워크덱 어드민 `/admin/leads`에서 `utm_medium=lead_email` 신청 수로 측정한다. 발송 후 2주간 본다.
5. 시점은 고객 공지(11/2)와 리다이렉트를 마친 뒤, 11월 중순에 1회 보낸다. 12/18 이후에는 Mailgun을 해지하므로 그 전에 끝낸다.

**같이 정리할 것**: Webflow를 해지하면(11/21 갱신 전) Make.com 시나리오 2개도 끈다. 웹훅 대상인 오프닝 API는 12/18에 종료된다.

## 공지일(~11/2) 실행 체크리스트 — 2026-10-30 갱신

공지 URL은 https://workdeck-work.notion.site/40982f170039814c9eb1dcc3ad51d800 이고 게시 완료다.

**값**

- opening_web `constants/closing.ts`(`ab5c9f5`): URL과 문의처 hello@peakpay.co.kr을 확정했다.
- opening_api 메일 환경변수(`--send` 실행 때 주입)
  - `CLOSING_NOTICE_URL` = 위 공지 URL
  - `CLOSING_CONTACT` = hello@peakpay.co.kr
  - `CLOSING_SIGNUP_STOP_DATE` = 2026년 11월 2일(월)
  - `CLOSING_DATA_RETENTION` = 서비스 종료 후 30일 이내(2027년 1월 17일까지)

**순서** (각 단계 승인 후 진행)

1. opening_api의 `chore/service-closing-block`(신규 가입·플랜 신청 차단 + `send_closing_notice` 워커)을 커밋하고 main에 push한다. Actions → ECS로 배포된다.
2. opening_web의 `chore/closing-notice`를 main에 push한다. 띠배너와 팝업이 나간다.
3. 배포 후 Aside u2로 배너·팝업·플랜 설정 화면을 실측하고, 신규 가입이 403으로 막히는지 확인한다.
4. 워크덱 Vercel에 `welcome.opening.work` 도메인을 추가하고, Route53 `welcome` CNAME을 `cname.vercel-dns.com`으로 바꾼다. 308으로 넘어가는지 확인한다.
5. 메일은 dry-run(대상 수 확인) → 테스트 1통 → 승인 → `--send` 순서로 보낸다.
6. Webflow 플랜을 해지하고 Make 시나리오 2개를 끈다. 11/21 갱신 전에 끝낸다.

## 2026-10-30 저녁 점검

- 이전 브랜치 `feat/opening-optin-migration`을 origin/main(`29e3a173`)으로 rebase했다(`62808fba`·`8d357ac9`·`198fe014`, 미푸시). 보장가 e2e 7개 통과. 마지막 커밋에 문서·HANDOFF.md가 섞여 있어 PR에서는 제외를 검토한다.
- opening_api `chore/service-closing-block` 로컬 커밋: `ba07f7e`(차단), `fe6bd9b`(메일 워커). 미푸시.
- opening_web 빌드 이미지 + 가짜 API로 브라우저 확인(운영 미접속): 팝업 표시, 이용 종료일, 닫기 후 새로고침 재노출, 다시 보지 않기 쿠키(2026-12-31 만료), 다시 보지 않기 후에도 배너 유지, 배너→노션 URL(새 탭), 이전 신청→가입 utm 링크, 375px 가로 넘침 없음, 페이지 오류 0. 플랜 설정 화면 표시 확인.
- 가짜 API에서 ACTIVE인데 플랜 설정으로 이동한 현상은 변경 전 커밋(`87167b0`)도 동일해 회귀가 아니다.
- 운영 워크덱 읽기 전용 조회: `recruiting`은 `SUBSCRIPTION`(paidActivatedAt 2026-09-11)이다. 토스 MID는 심사중·계약일 없음이라 라이브 결제 불가, prod는 테스트 키다. **이전 고객이 7일 체험 후 구독할 실제 결제 수단이 아직 없다.** 사용자 결정 필요.

## 2026-10-31 보장가 운영 반영

- develop #1275, main #1276 `41e87004`. 운영 마이그레이션 적용 확인(읽기 전용).
- 토스 공백기 방침(사용자 확정): 이전 고객 체험을 결제 가능일+7일까지 `set-trial`로 연장. 노션의 7일 원칙은 유지.
- 미해결: 운영 키가 테스트 키인 동안 고객이 구독을 누르면 실출금 없이 PAID·ACTIVE가 되고, 라이브 키 전환 시 그 빌링키가 무효가 된다.
- 토스 실호출 미검증: 실패 후 같은 orderId 재사용 가능 여부는 문서에 없어 샌드박스 확인 필요.
- 후속: cron 정기결제 응답 유실 시 잘못된 재시도 실패(이중 결제는 없음).

## 2026-10-31 이전 도구·공백기

- 구독 일시 중지: `BILLING_CHECKOUT_PAUSED=1` Production 등록, main `1ac4fb13`. 새 구독·일할 추가·카드 등록 차단(503). 계약 완료 또는 토스 결제 테스트 시 지우고 재배포.
- B1~B3 `feat/opening-import-tools` 로컬. 피크페이 prepare dry-run: 공고 609(대상 3: 포함1·보류2), 템플릿 39(포함15·보류24), 이미지 137(검수72), 매장7·직무51. 임시 SG 규칙 회수, 잔여 0.
- 리뷰 HIGH 4건(EXIF, 검수 미강제, 담당자 탐지, brand↔Space 대응)과 사람 해제 흐름을 반영 중. 실제 `--apply`는 그 뒤, 고객별 승인 후.
- RDS 인스턴스에 `nework_prod`·`redash_prod`가 함께 있다. 12/18 인스턴스 삭제 금지.

## 2026-10-31 이전 도구 실측(피크페이 dry-run, 쓰기 없음)

공고 609: 포함1·검토1·NO_TITLE1·기간외560·삭제46 / 템플릿 39: 포함18·검토21 / 매장7·직무51 전부 포함 / 이미지 152 중 검토 151 / 스키마 오류 0 / 내장 SVG 334 변환 성공, 실패 0.
남은 일: 실제 `--apply`는 고객별 승인 후. 첫 apply 전 변경분 독립 리뷰 1회. 이미지 검토량(고객당 약 150장) 운영 방식 결정.

## 2026-11-04 재점검 — 토스 계약 장기 지연 전제 (사용자 지시)

- **공지 미배포 확인**: opening_api·opening_web origin/main 에 차단·팝업 커밋 없음, welcome CNAME=Webflow(200), 메일 미발송. 노션은 "11/2 신규 가입 중단"으로 게시된 상태.
  - 실제 배포일로 바꿀 곳: 노션 표, 메일 env `CLOSING_SIGNUP_STOP_DATE`. opening 코드엔 날짜 하드코딩 없음(grep).
  - 기한: 11/18 일괄 해지 전 사전 고지. 첫 갱신 11/10 전(늦어도 11/11)까지 메일 도달. 넘기면 11/18 해지일·갱신 허용표 재계산.
- **12/18 종료는 유지**: 오프닝 운영비(~30만) > 매출(21.6만). 워크덱이 한 푼도 못 받아도 종료가 이득.
- **운영 상태(읽기 전용)**: 스위치 `BILLING_CHECKOUT_PAUSED=1`, 체험 중 일반 공간 0, 10/28 이후 가입 0, 리드 0. ACTIVE 1건=테스트 키 구독(11/11 갱신, 실출금 없음).
- **새 가입자 잠김 대응(제안)**: 스위치가 켜진 동안 체험 만료여도 잠그지 않는다. 판정은 `evaluateDeckAccess` 한 곳(레이아웃·쓰기·에이전트 가드 모두 `resolveEntitlement` 경유). 스위치 해제 시 만료 체험 공간은 즉시 잠기므로 해제 절차에 "일괄 체험 N일 부여" 단계 포함. 이전 고객 `set-trial`은 불필요해짐(lockedPrice는 그대로).
  - 기각: 상품을 FREE_BETA로 전환 — "베타 무료" 노출이 토스 반려 원인 재발 + 복귀 시 paidActivatedAt 재설정으로 GRACE 재시작.
- **토스**: 1544-7772 재문의 시 "빌링 별도 계약 전 일반결제(1회 카드결제)만 먼저 라이브 가능한지" 확인. Plan B(계좌이체 수동 청구)는 만들지 않고 결정일만 둔다: 12/1까지 계약 미완료면 재검토.
- **반영(11-04)**: 잠금 보류 main+prod #1298(develop)·#1299 `01458752`. 중지 중 `PAUSED` 허용 → 이전 고객 `set-trial` 불필요. 해제 절차 = `billing-admin trial-all <날짜>` 미리보기 → `--apply` → env 제거·재배포. EXPIRED·CANCELED 는 연장 대상 아님(해제 후 재결제).
- **공지 범위 변경(11-04, 사용자 지시)**: 토스 결제 이슈로 이전이 불가능할 수 있어 종료 공지에서 **워크덱 이전 안내 전부 제거**. opening*web(팝업 이전 섹션·배너 문구·`CLOSING_MIGRATION*\*` 상수 삭제, 파기 일정 상수 추가), opening_api 메일(제목 「서비스 종료 안내」, 이전 섹션·버튼 문구), 로컬 노션 원문 수정. 노션 실페이지는 워크덱 워크스페이스라 API 접근 불가 → 사용자가 직접 수정. 남은 워크덱 흔적=노션 URL 도메인(workdeck-work.notion.site).
- **공지 2버전 + 게시 보류(11-04, 사용자 지시)**: A안=종료만(opening_web `chore/closing-notice` `00c386e`, opening_api `chore/service-closing-block` `be54a87`, 노션 `2026-10-30-opening-closing-notion-notice.md`), B안=종료+이전(`chore/closing-notice-migration` `ab5c9f5`, `chore/service-closing-block-migration` `fe6bd9b`, 노션 `2026-11-04-opening-closing-notion-notice-with-migration.md`). 사용자가 최종 기한까지 기다렸다가 공지.
  - **최종 공지 기한 = 11/12(목)**: 약관(제11조)엔 사전 고지 기간 규정 없음. 11/18 일괄 해지는 미룰 수 없음(11/19 06:53 갱신분이 12/18을 넘김) → 가장 빠른 이용 종료 11/19 고객에게 지원자 다운로드 7일을 주려면 11/12까지 메일 도달. B안은 그 전날(11/11)까지 토스 계약이 끝났을 때만.
  - 기한까지 미공지 시 영향: 11/10·11/12 갱신 고객은 종료 사실을 모른 채 결제(이용기간은 12/18 전 종료라 정책상 문제는 없음).
