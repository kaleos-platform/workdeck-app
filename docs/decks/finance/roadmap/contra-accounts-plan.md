# 차감 계정(매출환입·매입환출) 작업 계획

- 작성: 2026-10-03
- 브랜치: `finance-improve-cashflow`
- 범위: 수익 차감(매출환입) + 비용 차감(매입환출) — 대칭 구조로 한 번에

## 배경

B2B·B2C 매출에서 반품·환불로 **고객에게 출금(OUT)** 이 생기면 수입에서 차감돼야 한다.
현재 구조에서는 불가능하다.

| 위치                                                  | 현재 동작                              | 문제                                        |
| ----------------------------------------------------- | -------------------------------------- | ------------------------------------------- |
| `CategoryCombobox` `blockType` (PR #331 방향 가드)    | OUT 거래는 수익(INCOME) 계정 선택 차단 | 환불을 수익 계정에 분류 자체가 안 됨        |
| 현금흐름 표 `queries.ts:376`                          | 섹션 = 거래 방향(IN/OUT)               | 억지로 분류해도 "지출 > 매출환입" 행으로 뜸 |
| 대시보드·거래내역 합계 `queries.ts:226`               | `groupBy(['direction'])`               | 수입 합계에서 안 빠짐                       |
| 월별 집계 `aggregate.ts`                              | 방향 기준                              | 동일                                        |
| Sankey `sankey/route.ts:102`                          | OUT이면 role 무관하게 지출측           | OUT+MERCH_SALES → **판관비로 잘못 들어감**  |
| 우측 패널·딥링크 `cashflow-view.tsx:1319,1436`        | `direction=` 필터                      | 매출 행 드릴다운에서 환불 거래가 **사라짐** |
| `directionForType()` (시드 규칙·`rule-suggest.ts:45`) | INCOME→IN 고정                         | 차감 계정 규칙이 반대 방향으로 생성됨       |

이미 정상인 곳(작업 불필요): `pnl-metrics.ts`(inSigned/outSigned), `queries.ts`의 손익계산서용 natSign, `pnl-statement` 금액 — 계정 type 기준 자연부호라 OUT→수익계정은 이미 수익 차감된다.

## 설계 원칙

1. **계정 단위 플래그로만 허용한다.** 방향 가드 자체는 유지(PR #331은 실제 prod 오분류 때문에 생김). 플래그 붙은 리프만 반대 방향을 받는다.
   - 허용 규칙: `allowed = (type이 방향과 일치) XOR isContra`
2. **섹션은 계정 기준으로 옮기되 차감 계정만.** 일반 계정은 지금처럼 방향 기준(오분류 내성 유지). 차감 계정은 계정 type 섹션에 **음수**로 들어간다.
3. **판정은 공유 헬퍼 하나로.** 방향 기준 집계 전부가 같은 함수를 지나게 해 화면 간 합계 불일치를 막는다.
4. **순현금흐름(net)은 변하지 않는다.** 수입/지출 사이에서 금액이 옮겨갈 뿐이다(환불 30: 수입 −30, 지출 −30).

## 작업 단계

### 1. 스키마 + 백필 마이그레이션

- `FinCategory.isContra Boolean @default(false)` 추가 — `npx prisma migrate dev --name fin_category_contra`
- 같은 마이그레이션 SQL에 기존 finance 공간 백필:
  - 각 공간 `수입 > 매출` 아래 `매출환입(반품·환불)` (INCOME, code `4100`, isContra=true)
  - 각 공간 `지출 > 상품원가` 아래 `매입환출(구매 환불)` (EXPENSE, code `5100`, isContra=true)
  - `ON CONFLICT ("spaceId","parentId","name") DO NOTHING` — 부모(매출/상품원가)를 사용자가 지우거나 이름을 바꾼 공간은 건너뜀(보고만)
  - id는 cuid 대신 `gen_random_uuid()::text` 등 마이그레이션 내 생성 방식 확인 후 결정
- 신규 공간: `kifrs-seed.ts` `OPERATIONAL_CHART`에 두 리프 추가(`SeedNode`에 `contra?: true`), `upsertCategory`에 전달
- K-IFRS 코드는 신규 번호를 만들지 않고 모계정 코드(4100/5100)를 재사용 — export 매핑(`kifrs-map.ts`) 변경 없음

### 2. 공유 판정 헬퍼 (`src/lib/finance/aggregate.ts`)

```ts
// 차감 계정이면 계정 type 섹션에 음수로, 그 외는 현금 방향 섹션에 양수로.
export function sectionOf(
  direction,
  amt,
  leaf?: { type; isContra }
): { section: 'IN' | 'OUT'; amount: number }
```

- 적용 대상(전부 이 헬퍼로 교체):
  - `aggregate.ts` 월별 income/expense, `aggregateIncomeByCategory`, `aggregateExpenseByCategory`
  - `queries.ts:376` 현금흐름 표 섹션·행 key
  - `queries.ts:226` 합계 — `groupBy(['direction','categoryId'])`로 바꾸고 헬퍼로 재합산(차감 계정 id 집합 필요)
  - `sankey/route.ts:102` — OUT+MERCH_SALES 차감이면 `merch -= amt`, IN+COGS 차감이면 `cogs -= amt`
  - `cashflow/route.ts` 총계, `export/route.ts:88` 구분 컬럼(차감 계정은 계정 섹션 라벨)
- `directionForType(type, isContra)`로 확장 — 시드 규칙·`rule-suggest.ts` 호출부 갱신

### 3. 드릴다운 필터 (놓치기 쉬움)

- `cashflow-view.tsx` 우측 패널 `load()`와 `buildTxnDeepLink()`가 `direction=`을 붙인다.
- 선택 행에 차감 계정이 포함되면 `direction` 필터를 빼고 `categoryIds`로만 조회.
  - 매출 대분류 행 클릭 → IN 판매정산 + OUT 환불 모두 보여야 함
- `pnl-statement.ts:155` row `direction`도 같은 이유로 확인.

### 4. 분류 UI 가드

- `CategoryCombobox`: 탭 단위 차단 → **옵션 단위 필터**로. OUT 거래면 수익 탭은 열리되 차감 계정만 노출. IN 거래면 비용 탭에 매입환출만 노출.
- 옵션 타입에 `isContra` 추가 — `category-options.ts`, categories API 응답.
- 적용처: `transactions-view.tsx`(per-row, 일괄바 `uniformBlockType`), `cashflow-view.tsx:1791` 패널, 스테이징 분류.
- `ai-suggest.ts` 후보 목록이 방향으로 type을 거르는지 확인 — 거르면 차감 계정 포함하도록.

### 5. 계정과목 관리 UI

- `add-category-dialog.tsx` / `edit-category-dialog.tsx`에 "차감 계정(반대 방향 거래를 차감)" 토글. 수익·비용 리프에서만 노출.
- 거래가 붙은 계정의 토글 변경 시 경고: "과거 거래의 수입/지출 집계 위치가 바뀝니다."
- categories POST/PATCH Zod 스키마에 `isContra` 추가.

### 6. 거래내역 합계

- 상단 수입/지출 합계를 현금흐름과 동일 기준(헬퍼)으로 — 2단계의 `queries.ts:226` 변경으로 자동 반영.
- 행 자체(입금/출금 표시)는 통장 그대로 유지.

## 검증

핵심 테스트 1건(`src/lib/finance/__tests__/`):

- 입력: 매출 IN 100 + 매출환입 OUT 30 + 상품매입 OUT 50 + 매입환출 IN 10
- 기대:
  - 현금흐름 표·대시보드·Sankey 모두 수입 70, 지출 40
  - 세 화면 net = 30 동일 (변경 전 net과도 동일)
  - 매출 행 드릴다운이 OUT 30 거래 포함
- 가드: OUT 거래에서 일반 수익 계정은 여전히 선택 불가(RTL 기존 4건 유지 + 차감 계정 노출 1건)

수동 QA(preview): 환불 거래 분류 → 현금흐름 3모드(현금/손익계산서/공헌이익) + Sankey + 거래내역 합계 + 딥링크.

`npm run lint`, `npm run build`, 기존 finance 테스트 통과.

## 위험·주의

- 백필 SQL은 마이그레이션 파일로만(prod 직접 SQL 금지). 부모 이름이 바뀐 공간은 누락될 수 있음 → 배포 후 누락 공간 수 확인.
- 기존에 OUT 환불을 비용 계정(예: 기타 비용)으로 분류해 둔 거래는 자동 이동 안 됨. 필요하면 사용자가 재분류.
- 일반 계정의 방향 기준 섹션 로직은 그대로 — 오분류 진단(memory: 방향 가드) 전제 유지.
