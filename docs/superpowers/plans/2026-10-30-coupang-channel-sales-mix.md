# 쿠팡 채널 관리 — 매출 구성(광고비 비중) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/d/coupang-ads/sales-mix` 에 쿠팡 전체 매출 대비 광고비 비중(상품 단위) 화면을 추가하고, deck 표시 이름을 「쿠팡 채널 관리」로 바꾼다.

**Architecture:** 순수 집계 함수(`src/lib/coupang-ads/sales-mix.ts`)가 SQL 집계 결과 행을 받아 KPI·주별·상품 행을 만든다. 조회 함수(`sales-mix-query.ts`)는 `$queryRaw` 4~5개로 행을 뽑아 순수 함수에 넘긴다. 서버 페이지가 초기 데이터를 넣고, 클라이언트가 기간 변경 시 `/api/coupang-ads/sales-mix` 로 재조회한다(기존 쿠팡 광고 홈과 같은 패턴).

**Tech Stack:** Next.js App Router, Prisma 7(`$queryRaw`), recharts 3, shadcn/ui, Tailwind v4, jest.

**Spec:** `docs/superpowers/specs/2026-10-30-coupang-channel-sales-mix-design.md`

## Global Constraints

- 데이터: `AdRecord` + `InventoryRecord`(`fileType='VENDOR_ITEM_METRICS'`)만. 새 수집 없음. 모두 Workspace 스코프(`resolveWorkspace`).
- 분모 = `revenue30d`(일자별 값, 취소 차감 후). `totalRevenue` 금지. 음수 행 필터 금지, 판매방식(`fulfillmentType`) 필터 금지.
- 광고비 비중 = 광고비 ÷ 전체 매출. 쿠팡 기준 광고매출 비중 = `revenue1d` 합 ÷ 전체 매출(100% 초과 그대로 표시, 라벨 「쿠팡 기준 광고매출 비중」 + 툴팁 "클릭 후 1일 내 구매를 모두 포함").
- optionId → productId 매핑 = 기간(이전 기간 포함) 내 **최신 snapshotDate** VENDOR 행.
- 매칭 안 되는 광고 옵션·`optionId` null 광고는 KPI 에 포함 + 표에 「판매 데이터 없음」 한 행(`productId: null`).
- 날짜 = KST 일자(`'YYYY-MM-DD'`). 주 = 월요일 시작 KST 주.
- 상태 임계값 상수: 🟢 광고 없이 판매 = 광고비 비중 ≤ 5% 그리고 판매수량 ≥ 기간 일수, 🔴 광고 의존 = 광고비 비중 ≥ 20%, ⚪ 중간 = 그 외.
- 이전 기간 = 같은 길이 직전 구간(`queryKpi` 규칙과 동일).
- deck id `coupang-ads`, 경로 `/d/coupang-ads/*`, 결제 상품 id 변경 금지. 이름만 「쿠팡 채널 관리」. 결제 상품명·마케팅 문구 포함(사용자 결정).
- DB 변경은 `npx prisma migrate dev` 로 만든 migration SQL 만. prod 직접 SQL·`db push` 금지.
- UI: 기존 쿠팡 광고 홈(`components/dashboard/dashboard-client.tsx`)의 기간 칩(7/30/90일, `h-7 text-xs`) + 날짜 입력 + KPI Card(제목+아이콘, `text-2xl` 값, 이전 대비) 패턴, `.codex/skills/workdeck-ui/SKILL.md`(중립색, 상태 pill 빨강=위험/에메랄드=정상/회색=중간, compact 표, sticky header, `tabular-nums`).

## Review Focus

1. **매출 ≤ 0 인데 광고비 있는 상품**(반품만 있는 기간) — 광고비 비중 `null`("—" 표시), 상태는 🔴 광고 의존. 0 나누기·`Infinity` 금지. → Task 1 테스트.
2. **광고 옵션이 VENDOR 에 없음 / optionId null** — KPI 광고비 = 표 광고비 합. → Task 1 테스트.
3. **이전 기간에만 있던 상품** — 기본 숨김(매출 0), 「매출 0 포함」 시 이전 기간 이름으로 표시, 이름이 비지 않음. → Task 1 테스트.
4. **기간 중 VENDOR 빠진 날** — `missingDays` 가 정확(기간 일수 − VENDOR 있는 KST 일수). → Task 1 테스트.
5. **판매 수집 꺼짐 / VENDOR 0행** — 빈 상태 + 설정 링크, 0% KPI 를 보여주지 않음. → Task 2·4 테스트.

---

### Task 1: 순수 집계·상태 판정

**Files:**
- Create: `src/lib/coupang-ads/sales-mix.ts`
- Test: `src/lib/coupang-ads/__tests__/sales-mix.test.ts`

**Interfaces:**
- Produces:
```ts
export const SALES_MIX_THRESHOLDS = { organicMaxAdShare: 0.05, dependentMinAdShare: 0.2, organicMinDailyQty: 1 } as const
export type SalesMixStatus = 'organic' | 'dependent' | 'neutral'
export function judgeSalesMixStatus(i: { revenue: number; adCost: number; salesQty: number; days: number }): SalesMixStatus
export function weekStartKst(ymd: string): string // 그 날이 속한 주의 월요일 'YYYY-MM-DD'

// SQL 이 돌려주는 행 (숫자는 이미 number 로 변환)
export interface VendorProductRow { productId: string; productName: string; revenue: number; salesQty: number }
export interface VendorDailyRow { date: string; revenue: number }
export interface AdOptionRow { optionId: string | null; adCost: number; adRevenue: number }
export interface AdDailyRow { date: string; adCost: number }

export interface SalesMixKpi { revenue: number; adCost: number; adShare: number | null; coupangAdRevenueShare: number | null }
export interface SalesMixProductRow {
  productId: string | null          // null = 「판매 데이터 없음」
  productName: string
  revenue: number; salesQty: number; adCost: number
  adShare: number | null; coupangAdRevenueShare: number | null
  prevAdShare: number | null
  adShareDeltaPp: number | null     // (adShare − prevAdShare) × 100, 둘 다 있을 때만
  revenueChangePct: number | null   // 이전 매출 > 0 일 때만
  status: SalesMixStatus
}
export interface SalesMixWeek { weekStart: string; revenue: number; adCost: number; adShare: number | null }
export interface SalesMixResult {
  from: string; to: string; days: number; missingDays: number
  kpi: SalesMixKpi; prevKpi: SalesMixKpi
  weeks: SalesMixWeek[]
  products: SalesMixProductRow[]  // 매출 0 행 포함 — 숨김은 화면에서
}
export function buildSalesMix(input: {
  from: string; to: string
  current: { products: VendorProductRow[]; ads: AdOptionRow[] }
  prev: { products: VendorProductRow[]; ads: AdOptionRow[] }
  daily: { vendor: VendorDailyRow[]; ads: AdDailyRow[] }  // 현재 기간
  optionToProduct: Map<string, string>
}): SalesMixResult
```

- [ ] **Step 1: 실패 테스트 작성** — `describe('judgeSalesMixStatus')`, `describe('weekStartKst')`, `describe('buildSalesMix')`:
  - `judgeSalesMixStatus({revenue:100000, adCost:5000, salesQty:30, days:30})` → `'organic'`(정확히 5%, 하루 1개)
  - `{revenue:100000, adCost:5000, salesQty:29, days:30}` → `'neutral'`(수량 미달)
  - `{revenue:100000, adCost:20000, salesQty:1, days:30}` → `'dependent'`(정확히 20%)
  - `{revenue:-3000, adCost:1000, salesQty:-1, days:7}` → `'dependent'`; `{revenue:0, adCost:0, salesQty:0, days:7}` → `'neutral'`
  - `weekStartKst('2026-10-29')` → `'2026-10-26'`; `weekStartKst('2026-10-26')` → `'2026-10-26'`; `weekStartKst('2026-11-01')` → `'2026-10-26'`
  - 옵션 2개(`o1`,`o2` → 상품 `p1`) 광고비 3,000+2,000 + 매칭 없는 `o9` 1,000 + `optionId:null` 500 → `products` 에 `p1.adCost === 5000`, `productId:null` 행 `adCost === 1500`·`productName === '판매 데이터 없음'`, `kpi.adCost === 6500 === sum(products.adCost)`
  - 매출 −3,000 · 광고비 1,000 상품 → `adShare === null`, `status === 'dependent'`
  - 이전 기간에만 있는 `p2`(이름 '이전상품') → 행 존재, `revenue === 0`, `productName === '이전상품'`, `revenueChangePct === -100`
  - `from:'2026-10-01', to:'2026-10-07'`, vendor daily 5일만 → `days === 7`, `missingDays === 2`
  - `weeks` 는 `weekStart` 오름차순, 주별 `revenue`·`adCost` 합이 `kpi` 와 같음
  - `products` 기본 정렬 = `revenue` 내림차순, `productId:null` 행은 맨 끝
- [ ] **Step 2: 실패 확인** — `npx jest src/lib/coupang-ads/__tests__/sales-mix.test.ts` → FAIL(모듈 없음)
- [ ] **Step 3: 구현** — `days` 는 `from`~`to` 포함 일수. `adShare = revenue > 0 ? adCost / revenue : null`. 상태 판정은 `adShare === null` 이면 `adCost > 0 ? 'dependent' : 'neutral'`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 커밋** — `git add src/lib/coupang-ads/sales-mix.ts src/lib/coupang-ads/__tests__/sales-mix.test.ts && git commit -m "feat(coupang-ads): 매출 구성 집계·상태 판정"`

### Task 2: 조회 함수 + API 라우트

**Files:**
- Create: `src/lib/coupang-ads/sales-mix-query.ts`
- Create: `app/api/coupang-ads/sales-mix/route.ts`
- Test: `src/lib/coupang-ads/__tests__/sales-mix-query.test.ts`

**Interfaces:**
- Consumes: Task 1 `buildSalesMix`, 행 타입들.
- Produces:
```ts
export type SalesMixEmptyReason = 'collection-off' | 'no-data'
export async function querySalesMix(workspaceId: string, opts: { startDate: string; endDate: string }):
  Promise<SalesMixResult | { empty: SalesMixEmptyReason }>
export interface SalesMixProductDetail {
  daily: { date: string; revenue: number; adCost: number }[]  // 기간 전 일자, 빈 날 0
  options: { optionId: string; optionName: string | null; revenue: number; salesQty: number }[]
}
export async function querySalesMixProductDetail(workspaceId: string, opts: { startDate: string; endDate: string; productId: string }): Promise<SalesMixProductDetail>
```
- API: `GET /api/coupang-ads/sales-mix?startDate&endDate[&productId]` — `productId` 있으면 detail, 없으면 `querySalesMix`. `startDate`/`endDate` 없거나 `isYmdDateString` 아니면 400(`errorResponse`). 구조는 `app/api/dashboard/kpi/route.ts` 와 동일(`withCoupangAdsTiming`, `resolveWorkspace`).

- [ ] **Step 1: 실패 테스트** — `queries.test.ts` 처럼 `@/lib/prisma` mock(`$queryRaw`, `coupangCredential.findUnique`):
  - `coupangCredential.findUnique` → `{ collectVendorSales: false }` 이면 `{ empty: 'collection-off' }`, `$queryRaw` 미호출
  - 수집 켜짐 + 현재 기간 VENDOR 상품 행 0 → `{ empty: 'no-data' }`
  - 정상 행(Decimal 대신 문자열 `'12000.00'` 반환) → `kpi.revenue === 12000`(숫자 변환 확인)
  - 크레덴셜 없음(`null`) → 수집 꺼짐으로 보지 않고 데이터 유무로 판단
- [ ] **Step 2: 실패 확인** — `npx jest src/lib/coupang-ads/__tests__/sales-mix-query.test.ts` → FAIL
- [ ] **Step 3: 구현** — 기간 경계는 `loadKpi` 와 같이 `new Date(ymd + 'T00:00:00+09:00')`/`'T23:59:59+09:00'`, 이전 기간 계산도 동일. KST 일자는 SQL `to_char(("snapshotDate" AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')`(AdRecord `date` 도 동일). 쿼리:
  1. VENDOR 상품별 합(현재·이전) — `GROUP BY "productId"`, 이름은 `(array_agg("productName" ORDER BY "snapshotDate" DESC))[1]`
  2. VENDOR 일별 매출(현재)
  3. 광고 옵션별 합(현재·이전) — `GROUP BY "optionId"` (null 포함)
  4. 광고 일별 광고비(현재)
  5. optionId → productId: `SELECT DISTINCT ON ("optionId") "optionId","productId" ... WHERE snapshotDate BETWEEN prevStart AND end ORDER BY "optionId","snapshotDate" DESC`
  detail 은 같은 매핑으로 해당 상품 옵션들의 광고 일별 + VENDOR 일별·옵션별 합. 캐시 쓰지 않음.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS
- [ ] **Step 5: 운영 수치 대조(읽기 전용)** — 로컬에서 dev DB 로 `querySalesMix` 1회 실행 스크립트(스크래치패드), 30일 `kpi.adCost` = 같은 기간 `queryKpi(...).adCost`. 불일치면 원인 기록 후 수정.
- [ ] **Step 6: 커밋** — `git add src/lib/coupang-ads/sales-mix-query.ts src/lib/coupang-ads/__tests__/sales-mix-query.test.ts app/api/coupang-ads/sales-mix/route.ts && git commit -m "feat(coupang-ads): 매출 구성 조회·API"`

### Task 3: 사이드바 섹션 + 경로 상수

**Files:**
- Modify: `src/lib/deck-routes.ts` (상수 추가)
- Modify: `src/components/layout/sidebar.tsx:208-239, 724-742`

**Interfaces:**
- Produces: `export const COUPANG_ADS_SALES_MIX_PATH = \`${COUPANG_ADS_BASE_PATH}/sales-mix\``

- [ ] **Step 1: 구현** — `COUPANG_MAIN_ROUTES` 평면 목록을 브랜드 운영과 같은 `SidebarSection` 구조로: 「쿠팡 광고 홈」은 섹션 위 단독 `RailLink`(기존 홈 active 규칙 유지), 섹션 **광고**(광고 분석·실행 관리) / **채널**(매출 구성·로켓그로스 재고) / **설정**(데이터 수집·설정). 아래 캠페인 블록은 그대로. 접힘(collapsed) 동작은 `SidebarSection` 기존 동작을 따른다.
- [ ] **Step 2: 확인** — `npm run typecheck` 통과(sidebar 전용 테스트 없음 — 화면 확인은 Task 4 Step 5 에서 함께)
- [ ] **Step 3: 커밋** — `git add src/lib/deck-routes.ts src/components/layout/sidebar.tsx && git commit -m "feat(coupang-ads): 사이드바 광고/채널/설정 섹션"`

### Task 4: 매출 구성 화면

**Files:**
- Create: `app/d/coupang-ads/sales-mix/page.tsx` (서버: `resolveWorkspace` → 기본 30일 `getDaysAgoStrKst(30)`~`getDaysAgoStrKst(1)` 로 `querySalesMix` 초기 조회, 실패 시 클라 재조회 — 홈 `page.tsx` 와 같은 리다이렉트 규칙)
- Create: `src/components/coupang-ads/sales-mix/sales-mix-client.tsx` (기간 칩·날짜·KPI·주별 차트·표·패널 상태)
- Create: `src/components/coupang-ads/sales-mix/sales-mix-table.tsx`
- Create: `src/components/coupang-ads/sales-mix/sales-mix-product-panel.tsx`
- Test: `src/components/coupang-ads/sales-mix/__tests__/sales-mix-table.test.tsx`

**Interfaces:**
- Consumes: Task 2 API 응답(`SalesMixResult | { empty }`, `SalesMixProductDetail`), Task 1 `SALES_MIX_THRESHOLDS`·`SalesMixStatus`, Task 3 경로.
- `SalesMixTable` props: `{ rows: SalesMixProductRow[]; onSelect: (productId: string) => void; selectedId?: string | null }`

- [ ] **Step 1: 실패 테스트(표)** — `@testing-library/react`:
  - 기본: 매출 0 행 숨김 → 「매출 0 포함」 체크 시 보임
  - 필터 칩 「광고 없이 판매 N」「광고 의존 N」 건수가 행 상태 수와 같고, 칩 클릭 시 해당 상태만
  - `adShare: null` 행은 「—」, `coupangAdRevenueShare: 1.09` 는 「109%」
  - 「판매 데이터 없음」 행은 클릭해도 `onSelect` 미호출
  - 「광고비 비중」 헤더 클릭 → 내림차순, 다시 클릭 → 오름차순
- [ ] **Step 2: 실패 확인** — `npx jest src/components/coupang-ads/sales-mix` → FAIL
- [ ] **Step 3: 구현** —
  - 제목 「매출 구성」, 설명문: "광고비 비중 = 광고비 ÷ 판매분석 전체 매출. 쿠팡 기준 광고매출은 클릭 후 1일 내 구매를 모두 포함합니다. 광고비는 쿠팡 광고 리포트 기준입니다."
  - KPI 4: 전체 매출 / 광고비 / 광고비 비중 / 쿠팡 기준 광고매출 비중(툴팁). 금액·비율 변화는 이전 기간 대비(비율은 %p). `missingDays > 0` 이면 KPI 위 안내 "기간 중 N일 판매 데이터 없음".
  - 주별 차트: recharts `ComposedChart` — 전체 매출 `Bar`(중립 회색) + 광고비 비중 `Line`(오른쪽 축 %). 툴팁에 주 기간 표기.
  - 표 열: 상품명 · 전체 매출 · 판매수량 · 광고비 · 광고비 비중 · 비중 변화(%p) · 매출 변화(%) · 쿠팡 기준 광고매출 비중 · 상태 pill(에메랄드 「광고 없이 판매」/빨강 「광고 의존」/회색 「중간」). sticky header, 숫자 `tabular-nums` 우측 정렬, 기본 매출 내림차순.
  - 상태 pill 툴팁에 임계값 문장(상수에서 생성): "광고비 비중 5% 이하 · 하루 평균 1개 이상" / "광고비 비중 20% 이상".
  - 행 클릭 → 우측 패널(`Sheet`): `?productId=` 재조회, 일별 매출 막대 + 광고비 선, 옵션별 매출·수량 표(광고 귀속 없음).
  - `empty: 'collection-off'` → "판매 수집이 꺼져 있습니다" + `COUPANG_ADS_SETTINGS_PATH` 링크 「설정에서 판매 수집 켜기」; `'no-data'` → "기간 내 판매 데이터가 없습니다" + 같은 링크.
- [ ] **Step 4: 통과 확인** — `npx jest src/components/coupang-ads/sales-mix` → PASS
- [ ] **Step 5: 화면 확인** — 비-3000 포트 dev 서버(메모리 `reference_dev_worktree_playwright_verify`), 30/90일 전환·표 필터·패널 열기 스크린샷. 사용자에게 `ssh -N -L <port>:localhost:<port> kaleos@kaleos-macmini.tail901ac3.ts.net` + URL 전달.
- [ ] **Step 6: 커밋** — 새 파일 4개 + 테스트 명시 스테이징, `git commit -m "feat(coupang-ads): 매출 구성 화면"`

### Task 5: deck 이름 「쿠팡 채널 관리」

**Files:**
- Modify (문자열 교체): `src/lib/deck-meta.ts:42`(+ `description` 갱신), `src/lib/billing/catalog-defaults.ts:18,27`, `prisma/seed.ts:20`, `src/lib/workspace.ts:64`, `src/components/approvals/types.ts:42`, `src/components/approvals/approval-list.tsx:43`, `src/lib/slack/notify-pending-action.ts:24`, `src/lib/slack-inventory-notifier.ts:9`(주석), `app/d/coupang-ads/page.tsx:70`, `app/d/coupang-ads/settings/page.tsx:60`, `src/components/sh/settings/integration-catalog.tsx:24`, `src/components/sh/inventory/reconciliation-upload.tsx:475-491`, `app/api/sh/inventory/reconciliation/route.ts:105,153`, `app/d/seller-ops/settings/integration/page.tsx:20-21`(주석), `app/(auth)/d/[deckKey]/login/page.tsx:11`, `src/lib/marketing/decks/coupang-ads.ts:6,8,75,115`, `app/(marketing)/page.tsx:16,44`, `app/(marketing)/about/page.tsx:15,52`, `app/(marketing)/terms/page.tsx:20`, `app/llms.txt/route.ts:16`, e2e 테스트 2개(`auto-reconciliation-cron.e2e.test.ts:96`, `worker-sweep-scope.e2e.test.ts:211`)
- Create: `prisma/migrations/<ts>_rename_coupang_channel_deck/migration.sql`

- [ ] **Step 1: 교체** — 위 위치의 「쿠팡 광고 관리」 → 「쿠팡 채널 관리」. 조사 맞춤: `coupang-ads.ts:115` 「쿠팡 광고 관리은」 → 「쿠팡 채널 관리는」. `deck-meta.ts` description: "쿠팡 광고 성과 분석과 함께 전체 매출 중 광고비 비중·광고 없이 팔리는 상품을 한눈에 봅니다." 마케팅 `coupang-ads.ts:6,8` title/description 도 광고 + 매출 구성을 포괄하도록 다듬는다(광고 리포트 기능 설명은 유지). 「쿠팡 광고 홈」·「쿠팡 광고 워크스페이스」 등 광고 기능 자체를 가리키는 다른 표현은 바꾸지 않는다.
- [ ] **Step 2: migration** — `npx prisma migrate dev --create-only --name rename_coupang_channel_deck` 후 SQL:
```sql
-- deck 표시 이름 변경 (id·경로·가격 불변). seed 는 prod 에서 돌지 않으므로 여기서 갱신.
UPDATE "DeckApp" SET name = '쿠팡 채널 관리' WHERE id = 'coupang-ads';
UPDATE "BillingDeckProduct" SET name = '쿠팡 채널 관리' WHERE id = 'coupang-ads';
```
  shadow DB 오류 시 메모리 `reference_migrate_shadow_bypass` 절차. 이어서 `npx prisma migrate dev`(dev DB 적용).
- [ ] **Step 3: 잔여 확인** — `grep -rn '쿠팡 광고 관리' src app prisma/seed.ts` → 결과 0(과거 migration 파일 제외)
- [ ] **Step 4: 확인** — `npm run typecheck`, `npx jest app/d/coupang-ads src/components/approvals` 통과(제목 문자열을 단언하는 테스트는 새 이름으로 갱신)
- [ ] **Step 5: 커밋** — 변경 파일 명시 스테이징, `git commit -m "feat(coupang-ads): deck 이름 쿠팡 채널 관리로 변경"`

### Task 6: 전체 검증

- [ ] `npm run lint` · `npm run typecheck` · `npx jest src/lib/coupang-ads src/components/coupang-ads app/d/coupang-ads` · `npm run build` 모두 통과(출력 첨부)
- [ ] 변경 파일에 `TODO`·`test.skip`·`.only` 없음: `git diff origin/main --name-only | xargs grep -n "TODO\|\.skip(\|\.only(" ` → 0
- [ ] 결제 화면(`/settings/billing` 계열)·마케팅 요금 페이지·약관에서 상품명이 모두 「쿠팡 채널 관리」로 보이는지 dev 화면 확인
