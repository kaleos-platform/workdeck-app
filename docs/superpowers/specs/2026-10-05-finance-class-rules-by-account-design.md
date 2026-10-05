# 재무 자동 분류 규칙 — 계좌 단위 관리·검색·수정 설계

- 작성일: 2026-10-05
- 대상: 재무 관리 deck `/d/finance/accounts` 「자동 분류 규칙」 탭
- 상태: grill-me 합의 완료 → spec 검토 대기

## 1. 배경

운영 규칙 674개가 한 목록에 시간순으로만 쌓여 관리가 어렵다. 삭제만 되고 수정·검색이 없다.

코드 확인 결과:

- `FinClassRule` 은 space 전체 공용이고 유일키는 `(spaceId, matchKey, direction)` — 계좌 개념이 없다.
- 거래 분류 시 `learnRule` 은 같은 키 규칙이 있으면 **경고 없이 계정과목을 덮어쓴다**(upsert). 규칙 관리 화면의 「규칙 추가」도 같은 키면 조용히 덮어쓴다(`created:false` 만 반환).
- dev 데이터(규칙 103개·계좌 17개): 거래가 매칭된 규칙 100개 중 2개 이상 계좌에서 쓰인 규칙 0개 — 규칙은 사실상 계좌 하나에 속한다.

## 2. 합의 사항 (grill-me)

| #   | 항목              | 결정                                                                                                            |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | 계좌 단위         | 적용 범위까지 계좌별. `accountId` 지정 규칙은 그 계좌 거래에만, 미지정(null)은 전체 공통                        |
| 2   | 자동 학습 범위    | 분류한 거래의 계좌 전용으로 학습                                                                                |
| 3   | 기존 규칙 이전    | 매칭 이력으로 자동 배정(한 계좌만 → 그 계좌, 여러 계좌·이력 없음 → 공통). 배포 전 운영 데이터로 시뮬레이션 보고 |
| 4   | 덮어쓰기          | 학습은 덮어쓰되 명시(사전 경고/사후 알림). 규칙 관리 화면 추가·수정이 다른 규칙과 겹치면 차단(409)              |
| 5   | 수정 시 기존 거래 | 수정 팝업 「이 규칙으로 분류된 기존 거래 N건도 함께 변경」(기본 해제). 확인·처리 대기 행은 항상 재분류          |
| 6   | 화면              | 좌측 계좌 목록(규칙 수) + 우측 규칙 표·검색·필터, 행 클릭 → 수정 팝업                                           |
| 7   | 추가 개선         | 사용 현황(매칭 거래 수·최근 매칭일, 미사용 필터), 매칭 미리보기                                                 |
| 8   | 우선순위          | 완전일치(계좌) > 완전일치(공통) > 부분포함(계좌) > 부분포함(공통)                                               |

범위 밖: 다중 선택 일괄 작업, 규칙 전용 사이드바 메뉴 분리.

## 3. 데이터 모델

```prisma
model FinClassRule {
  // ...
  // 적용 계좌 — null = 전체 계좌 공통. 지정 시 그 계좌 거래에만 매칭.
  accountId   String?
  account     FinAccount? @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@unique([spaceId, accountId, matchKey, direction])   // 기존 (spaceId, matchKey, direction) 대체
  @@index([spaceId, accountId])
}
```

- 계좌 삭제 시 그 계좌 전용 규칙도 삭제(거래도 cascade 되므로 일관). `FinAccount.classRules` 역관계 추가.
- PostgreSQL 유일 인덱스는 NULL 을 서로 다른 값으로 본다 → 공통 규칙(`accountId` null)·방향 무관(`direction` null) 규칙의 중복은 **앱 레벨 `findFirst` 검사**로 막는다(기존 시드·수동 추가가 이미 쓰는 패턴). 학습 규칙은 `accountId`·`direction` 모두 non-null 이라 compound upsert 사용 가능.
- **옛 3요소 키 조회 전수 수정**: `accountId` 조건 없는 `finClassRule.findFirst({ spaceId, matchKey, direction })` 는 계좌 전용 규칙까지 잡는다. 아래 모두 `accountId` 를 명시(시드·공통은 `null`):
  - `kifrs-seed.ts` `upsertSeedRule` (공통 시드가 같은 키의 계좌 학습 규칙 때문에 생성 누락되는 것 방지)
  - `app/api/finance/rules/route.ts` POST
  - `agent/actions/finance.ts` 규칙 추가 액션(기본 공통 범위)
  - 구현 계획에 `grep -rn "finClassRule.findFirst\|spaceId_matchKey_direction"` 체크 단계 포함

### 3.1 기존 규칙 이전 (마이그레이션 SQL)

같은 마이그레이션에서 컬럼 추가 → 백필 → 유일 인덱스 교체 순서:

```sql
UPDATE "FinClassRule" r SET "accountId" = s.acc
FROM (
  SELECT t."matchedRuleId" AS rid, MIN(t."accountId") AS acc
  FROM "FinTransaction" t JOIN "FinClassRule" r2 ON r2.id = t."matchedRuleId"
  WHERE t."categoryId" = r2."categoryId"            -- 이후 수동 재분류된 거래(stale matchedRuleId) 제외
  GROUP BY t."matchedRuleId"
  HAVING COUNT(DISTINCT t."accountId") = 1
) s
WHERE r.id = s.rid;
```

- 기존 유일키에 `accountId` 를 더하는 것이라 백필로 유일성 위반은 생길 수 없다.
- 시드 키워드 규칙(`learnedFrom=SEED`)은 여러 계좌에 매칭되므로 자연히 공통으로 남는다.
- 백필 SELECT 는 한 벌만 둔다 — 시뮬레이션 스크립트가 마이그레이션 SQL 의 SELECT 부분을 그대로 읽어 실행(문구 drift 방지).
- **구현 착수 전**: 같은 SELECT 를 운영 DB 에서 읽기 전용으로 실행해 「계좌 배정 N개 / 공통 유지 M개(여러 계좌 a·이력 없음 b)」를 보고하고 승인 후 배포.

## 4. 매칭 엔진 (`src/lib/finance/classify.ts`)

- `ClassRuleLite` 에 `accountId: string | null` 추가. `loadSpaceRules` 가 함께 로드.
- `classifyRow(input, rules, direction, accountId)` — 4번째 인자 추가. 다른 계좌 전용 규칙은 후보에서 제외.
- 우선순위(높은 것부터):
  1. EXACT + 이 계좌
  2. EXACT + 공통
  3. KEYWORD + 이 계좌
  4. KEYWORD + 공통

  같은 단계 안에서는 기존과 동일: 방향 지정 규칙 > 방향 무관(null), KEYWORD 는 긴 matchKey 우선. 결과 상태(EXACT=CLASSIFIED, KEYWORD=REVIEW)는 기존과 동일.

- 호출처: `imports/commit-staging`(임포트 계좌), `rule-suggest.ruleSuggestionFor`(행 계좌 — 시드 합성 규칙은 `accountId: null`), `staging` GET.

### 4.1 학습 (`learnRule`)

- 시그니처: `learnRule(spaceId, input, categoryId, direction, accountId, memo?)` → `{ ruleId, previousCategoryId } | null`.
  - upsert 키 `(spaceId, accountId, matchKey, direction)` — 다른 계좌의 같은 적요 규칙은 건드리지 않는다.
  - `previousCategoryId`: 기존 규칙이 있었고 계정과목이 달랐으면 그 값(덮어쓰기 발생), 아니면 null.
- 호출처: `staging/[id]` PATCH, `transactions/[id]` PATCH, MCP `agent/actions/finance.ts`(classify) — 각 거래·행의 `accountId` 를 select 에 추가해 전달.
- `previousCategoryId` 는 upsert 전 조회가 필요 → 조회+upsert 를 한 트랜잭션으로.
- 환불 방향 학습 제외 규칙 유지.

### 4.2 덮어쓰기 알림

계좌 전용 학습이 되면 흔한 경우는 「같은 키 덮어쓰기」가 아니라 「다른 계정과목의 **공통 규칙**을 이 계좌 새 규칙이 앞지르는 것」이다. 그래서 경고·알림은 같은 키 조회가 아니라 **`classifyRow(input, rules, direction, accountId)` 로 지금 실제 적용되는 규칙**을 기준으로 계산한다(매칭과 같은 코드 경로).

- 두 가지 문구:
  - 이 계좌 규칙이 이미 있음(같은 키): 「이 계좌의 규칙 〈X〉 → 〈Y〉로 변경됩니다」
  - 공통 규칙(또는 이 계좌의 부분포함 규칙)이 적용 중: 「이 계좌에 새 규칙 〈Y〉가 생겨 공통 규칙 〈X〉 대신 적용됩니다」
  - 적용 규칙이 없거나 계정과목이 같으면 표시 없음.
- **사전 경고**(대화상자가 있는 곳): `GET /api/finance/rules/lookup?accountId&direction&description&counterparty` → `{ applied: { ruleId, categoryId, categoryLabel, scope: 'ACCOUNT'|'COMMON', sameKey: boolean } | null }`. 확인·처리 분류 확인 팝업(`ClassifyConfirmDialog`)과 현금흐름 편집 팝업(`TxnEditPopover`)에서 「규칙으로 저장」이 켜져 있으면 위 문구 표시.
- **사후 알림**(대화상자 없이 바로 저장되는 거래내역 인라인 분류): 학습 직전 같은 계산 결과를 PATCH 응답 `ruleNotice: { kind: 'REPLACED'|'OVERRIDES_COMMON', fromLabel } | null` 로 돌려주고 토스트.

## 5. 규칙 API

| 메서드 | 경로                                | 변경                                                                                                                                                         |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/finance/rules`                | 응답 행에 `accountId`, `account{name,kind}`, `usage{count,lastMatchedAt}` 추가. 전량 반환 유지(674개 — 검색·필터는 클라이언트)                               |
| POST   | `/api/finance/rules`                | `accountId`(선택, space 소유 검증). 같은 `(account, key, direction)` 규칙이 있으면 **409** `{ error, existing: {id, categoryLabel} }` — 조용한 덮어쓰기 제거 |
| PATCH  | `/api/finance/rules/[id]` (신규)    | `matchKey`·`matchType`·`categoryId`·`accountId`(null 허용)·`memo`·`applyToExisting`                                                                          |
| DELETE | `/api/finance/rules/[id]`           | 변경 없음                                                                                                                                                    |
| POST   | `/api/finance/rules/preview` (신규) | `{ matchKey, matchType, accountId, categoryId }` → `{ count, samples[≤5] }`                                                                                  |
| GET    | `/api/finance/rules/lookup` (신규)  | §4.2                                                                                                                                                         |

- **사용 현황** `usage`: **텍스트 매칭 기준** — 규칙 범위(계좌/공통)·방향의 확정 거래 중 이 규칙 조건(EXACT=정규화 전체 일치, KEYWORD=포함)에 걸리는 거래 수·최근 `txnDate`. 미리보기와 같은 함수(`ruleMatchesText`)를 쓴다.
  - `matchedRuleId` 기준은 쓰지 않는다: 확인·처리에서 학습 분류하면 `matchedRuleId` 가 새 완전일치 규칙으로 바뀌고(`staging/[id]`), 일괄 분류는 null 로 지운다(`staging/bulk`) → 부분포함 규칙은 실제로 쓰여도 0건으로 잡혀 「미사용」 오표시된다.
  - 계산: space 확정 거래의 `(accountId, direction, 정규화 텍스트, txnDate)` 를 1회 로드해 메모리에서 규칙별 집계(EXACT 는 텍스트→건수 맵, KEYWORD 는 포함 검사).
- **PATCH 동작**:
  1. 방향은 계정과목 type 에서 재유도(`directionForType`).
  2. 자기 자신을 뺀 같은 `(spaceId, accountId, matchKey, direction)` 규칙이 있으면 409.
  3. `applyToExisting=true` 이고 계정과목이 바뀌었으면: `matchedRuleId = id AND categoryId = 이전 categoryId` 인 확정 거래를 새 계정과목으로(`isTransfer` 재계산). 응답 `updatedTransactions`.
  4. 확인·처리 대기(DRAFT 임포트) 행 재분류: `matchedRuleId = id` 이거나 `classStatus ∈ {UNCLASSIFIED, REVIEW}` 인 행을 최신 규칙셋으로 다시 분류(사용자가 직접 분류한 CLASSIFIED 행 중 다른 규칙 매칭분은 건드리지 않음). 응답 `reclassifiedStaged`.
- **재분류 헬퍼 공용화**: `imports/commit-staging` 의 행별 분류 결과 적용 로직(classStatus·matchedRuleId 설정, CLASSIFIED 일 때만 규칙 memo 복사)을 `classify.ts` 의 `applyClassification(row, rules, accountId)` 로 추출해 업로드·PATCH·DELETE 가 함께 쓴다(세 번째 분류 루프를 만들지 않는다).
- **DELETE 도 같은 헬퍼 사용**: 지금은 삭제된 규칙으로 분류된 대기 행을 미분류로만 되돌리지만, 남은 규칙(예: 공통 규칙)으로 다시 분류한다.
- **미리보기**: 범위(계좌 지정 시 그 계좌, 공통이면 전체)의 확정 거래 적요+상대를 정규화해 이 규칙 하나로 매칭(EXACT=전체 일치, KEYWORD=포함, 방향=계정과목 방향). 전체 건수 + 최근 5건. 다른 규칙과의 우선순위는 고려하지 않음(「이 키워드가 걸리는 범위」 확인용) — 팝업 문구로 명시.
- MCP `finance` 규칙 추가 액션: `accountId` 선택 파라미터 추가, 기존 upsert(승인 큐 경유) 의미 유지.

## 6. 화면 (`/d/finance/accounts` 「자동 분류 규칙」 탭)

`accounts-manager.tsx`(1,058줄)의 `RuleManager` 를 `src/components/finance/class-rules-manager.tsx` 로 분리.

- **좌측 패널**: 「전체」, 「전체 공통」, 계좌 목록(종류·이름·규칙 수). 기본 선택 「전체」.
- **우측**:
  - 상단: 검색창(키워드·계정과목명·메모, 클라이언트 필터), 필터(일치 방식 전체/완전/부분 · 방향 전체/수입/지출 · 「미사용만」), 「규칙 추가」 버튼.
  - 표 컬럼: 키워드 · 일치 방식 · 방향 · 계정과목 · 계좌(「전체」 선택 시) · 메모 · 매칭 수 · 최근 매칭 · 삭제.
  - 행 클릭 → 수정 팝업.
- **추가/수정 팝업**(같은 컴포넌트):
  - 키워드, 일치 방식, 계정과목, 계좌(「전체 공통」 + 계좌 목록, 추가 시 좌측 선택값이 기본), 메모.
  - 매칭 미리보기(입력 디바운스 후 「이 조건에 걸리는 확정 거래 N건」 + 최근 5건).
  - 수정 모드 + 계정과목 변경 시: 「이 규칙으로 분류된 기존 거래 N건도 함께 변경」(기본 해제, N=사용 현황 count).
  - 409 → 「같은 조건의 규칙이 이미 있습니다: 〈X〉 — 그 규칙을 수정하세요」, 저장 차단.

## 7. 테스트

- 단위 `classify.test.ts`: 4단계 우선순위, 다른 계좌 전용 규칙 미매칭, 같은 단계 내 방향·길이 우선 유지.
- e2e(dev DB, throwaway space):
  - 계좌 A·B 에서 같은 적요를 다른 계정과목으로 학습 → 규칙 2개, 서로 덮어쓰지 않음. 같은 계좌 재학습은 `previousCategoryId` 반환.
  - POST/PATCH 충돌 409, PATCH 성공 시 방향 재유도.
  - `applyToExisting`: 일치 거래만 변경, 이후 수동 재분류된 거래(카테고리 다름)는 유지.
  - PATCH 후 DRAFT 대기 행 재분류.
  - GET `usage` 텍스트 매칭 집계(부분포함 규칙이 확인 분류로 `matchedRuleId` 를 잃어도 사용 중으로 집계), preview 건수.
  - `upsertSeedRule` 이 같은 키 계좌 규칙이 있어도 공통 시드를 만든다.
  - lookup: 공통 규칙 X 적용 중 → `OVERRIDES_COMMON`, 같은 키 계좌 규칙 → `REPLACED`.
- 백필 SQL: e2e 에서 같은 SELECT 로직을 검증(단일 계좌 → 배정, 다계좌 → null, stale 제외).

## 8. 위험

- 계좌 배정된 기존 규칙은 다른 계좌의 같은 적요에 더 이상 적용되지 않는다 → 시뮬레이션 보고로 사전 확인. 새 계좌 첫 업로드는 학습량이 줄어 미분류가 늘 수 있음(대신 오분류는 줄어듦).
- 공통/방향무관 규칙의 동시 생성 중복은 앱 레벨 검사라 경쟁 조건 여지 있음(기존과 동일 수준).
