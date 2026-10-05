# 재무 거래 「분석 제외」 구분값 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확정 거래 1건 단위로 「분석 제외」를 지정하고, 현금흐름·대시보드·Sankey·거래내역 요약에서 기본 제외하되 토글로 포함해 볼 수 있게 한다.

**Architecture:** `FinTransaction.excludeFromAnalysis` 불리언 컬럼 1개. 집계 쿼리(`queryCashflow`/`queryDashboard`/sankey)의 거래 `findMany` where 에 `includeExcluded` 옵션이 false 일 때 `excludeFromAnalysis: false` 를 추가한다. 잔액·부채·스냅샷 경로는 건드리지 않는다. 지정은 기존 PATCH/bulk 라우트 확장.

**Tech Stack:** Next.js 16 App Router, Prisma 7(PostgreSQL), React 19 + shadcn/ui, Jest(e2e = dev DB).

**Spec:** `docs/superpowers/specs/2026-10-05-finance-exclude-from-analysis-design.md`

## Global Constraints

- 컬럼명 `excludeFromAnalysis Boolean @default(false)` — `FinTransaction` 에만. `FinStagedRow` 에는 추가 금지.
- UI 명칭 「분석 제외」, 토글 문구 「분석 제외 거래 포함」. 기존 계정과목 제외 UI 는 「계정 제외」 — 혼용 금지.
- URL/API 파라미터 `includeExcluded=1`(포함), 거래내역 범위 `scope=all|included|excluded`. 기존 `exclude` 파라미터 재사용 금지.
- 스키마 변경은 `npx prisma migrate dev --name finance_txn_exclude_from_analysis` 만. `db push`·prod 직접 SQL 금지.
- 잔액 스냅샷(`snapshot-rebuild.ts`), 대시보드 `repaymentTxns`·`snapshots`·`liabilities` 쿼리에는 필터 금지.
- 코드 스타일: 2칸 들여쓰기, 작은따옴표, 세미콜론 없음(기존 파일 스타일). 주석은 한국어.
- 커밋: `✨ feat(finance): ...` 형식, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 변경 파일을 명시해 `git add` (`-A` 금지).

## Review Focus

1. **재업로드 후 분석 제외가 풀리는 것** — 같은 파일을 다시 올려 DUP_CHANGED/DUP_OVERWRITE 로 저장돼도 `excludeFromAnalysis=true` 유지. (Task 1 테스트)
2. **현금흐름 셀 ≠ 드릴다운 패널 합계** — 토글 off 에서 패널 목록에 분석 제외 거래가 섞이면 사용자는 숫자가 안 맞는다고 본다. 패널은 토글 상태를 그대로 따른다. (Task 4 수동 검증 + Task 2 API 테스트의 `scope=included`)
3. **계정과목 재분류 시 분석 제외가 리셋되는 것** — `isTransfer` 는 재분류 시 덮어써지지만 새 컬럼은 그러면 안 된다. (Task 1 테스트)
4. **이체이면서 분석 제외인 거래** — 둘 다 집계 제외이므로 이중 차감·음수 없음. 거래내역 `scope=excluded` 요약은 이체를 계속 뺀다. (Task 2 테스트)
5. **다른 space 의 id 를 bulk 로 지정** — 0건 갱신. (Task 1 테스트)

---

## File Structure

| 파일                                                                                 | 책임                          | Task |
| ------------------------------------------------------------------------------------ | ----------------------------- | ---- |
| `prisma/schema.prisma` + `prisma/migrations/<ts>_finance_txn_exclude_from_analysis/` | 컬럼 추가                     | 1    |
| `app/api/finance/transactions/[id]/route.ts`                                         | 단건 지정/해제                | 1    |
| `app/api/finance/transactions/bulk/route.ts`                                         | 일괄 지정/해제                | 1    |
| `src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts` (신규)                 | 지정·보존·집계 e2e            | 1, 2 |
| `src/lib/finance/queries.ts`                                                         | 집계 필터·scope·excludedCount | 2    |
| `app/api/finance/{cashflow,dashboard,transactions,cashflow/sankey,export}/route.ts`  | 파라미터 파싱·export 컬럼     | 2    |
| `src/components/finance/transactions-view.tsx`                                       | 범위 필터·배지·일괄 버튼      | 3    |
| `src/components/finance/cashflow-view.tsx`, `cashflow-sankey.tsx`                    | 토글·패널·딥링크              | 4    |
| `src/components/finance/dashboard-view.tsx`                                          | 토글·제외 건수 힌트           | 5    |

e2e 실행 명령(전 Task 공통): `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts`
(`.env.local` 의 dev DB 필요. `DATABASE_URL` 없으면 describe.skip 으로 전부 skip 되므로 **"skipped" 가 아니라 "passed" 수를 확인**할 것.)

---

### Task 1: 컬럼 추가 + 지정 API (단건·일괄) + 재업로드 보존

**Files:**

- Modify: `prisma/schema.prisma` (model `FinTransaction`, `isTransfer` 줄 아래)
- Create: `prisma/migrations/<자동>_finance_txn_exclude_from_analysis/migration.sql` (migrate dev 생성)
- Modify: `app/api/finance/transactions/[id]/route.ts`
- Modify: `app/api/finance/transactions/bulk/route.ts`
- Test: `src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts` (신규)

**Interfaces:**

- Produces: DB 컬럼 `FinTransaction.excludeFromAnalysis: boolean`
- Produces: `PATCH /api/finance/transactions/[id]` body `{ excludeFromAnalysis: boolean }` → `{ transaction: { ..., excludeFromAnalysis } }`
- Produces: `POST /api/finance/transactions/bulk` body `{ ids: string[], excludeFromAnalysis: boolean }` → `{ updated: number }`

- [ ] **Step 1: 스키마 수정**

`prisma/schema.prisma` 의 `model FinTransaction` 에서 `isTransfer    Boolean         @default(false)` 바로 아래에 추가:

```prisma
  // 분석 제외 — 개인 목적 급여·외부 계약 등 본 사업과 무관한 거래(수동 지정).
  // true면 현금흐름·대시보드·손익 지표 집계에서 기본 제외(includeExcluded=1 로 포함). 잔액에는 영향 없음.
  // 계정과목과 독립 — 재분류·재업로드가 이 값을 바꾸지 않는다.
  excludeFromAnalysis Boolean   @default(false)
```

- [ ] **Step 2: 마이그레이션 생성**

Run: `npx prisma migrate dev --name finance_txn_exclude_from_analysis`
Expected: `prisma/migrations/2026..._finance_txn_exclude_from_analysis/migration.sql` 생성, 내용은
`ALTER TABLE "FinTransaction" ADD COLUMN "excludeFromAnalysis" BOOLEAN NOT NULL DEFAULT false;` 한 줄.
shadow DB 에러(`storage.buckets` 등)가 나면 `migration.sql` 을 위 한 줄로 직접 작성한 뒤
`npx prisma migrate deploy` + `npx prisma generate` 로 dev DB 에 적용한다. 다른 SQL 이 섞여 생성되면 중단하고 보고.

- [ ] **Step 3: 실패하는 e2e 테스트 작성**

Create `src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts`:

```ts
/** @jest-environment node */
/**
 * 「분석 제외」(FinTransaction.excludeFromAnalysis) e2e — 지정 API·재업로드 보존·집계 필터.
 * route handler 를 직접 호출한다. DB 는 실제 dev DB(throwaway space). DATABASE_URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { PATCH as txnPatch } from '../../../../app/api/finance/transactions/[id]/route'
import { POST as txnBulk } from '../../../../app/api/finance/transactions/bulk/route'
import { POST as stagingCommit } from '../../../../app/api/finance/staging/commit/route'

const SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000e1'
const OTHER_SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000e3'
const USER_ID = 'e2e0fin0-0000-4000-8000-0000000000e2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.spaceMember.deleteMany({ where: { userId: USER_ID } })
  await prisma.deckInstance.deleteMany({ where: { spaceId: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
  await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

d('finance exclude-from-analysis (dev DB)', () => {
  let accountId: string
  let incomeCatId: string
  let otherIncomeCatId: string
  let normalTxnId: string
  let excludedTxnId: string
  let otherSpaceTxnId: string

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-fin-exclude@throwaway.test' } })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E FinExclude' } })
    await prisma.space.create({ data: { id: OTHER_SPACE_ID, name: 'E2E FinExclude Other' } })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })

    accountId = (
      await prisma.finAccount.create({
        data: {
          spaceId: SPACE_ID,
          name: '제외테스트계좌',
          kind: 'BANK',
          institution: '테스트은행',
        },
        select: { id: true },
      })
    ).id
    // 실제 트리처럼 대분류 → 리프 구조(현금흐름은 리프를 행으로, 대분류를 메타로 쓴다)
    const parentId = (
      await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, name: '제외테스트수익', type: 'INCOME' },
        select: { id: true },
      })
    ).id
    incomeCatId = (
      await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, parentId, name: '제외테스트매출', type: 'INCOME' },
        select: { id: true },
      })
    ).id
    otherIncomeCatId = (
      await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, parentId, name: '제외테스트기타수익', type: 'INCOME' },
        select: { id: true },
      })
    ).id

    const base = {
      spaceId: SPACE_ID,
      accountId,
      direction: 'IN' as const,
      categoryId: incomeCatId,
      classStatus: 'CLASSIFIED' as const,
    }
    normalTxnId = (
      await prisma.finTransaction.create({
        data: {
          ...base,
          txnDate: new Date('2026-01-10T00:00:00Z'),
          amount: 100000,
          description: '본업 매출',
          identityKey: 'e2e-ex-normal',
          contentHash: 'h-normal',
        },
        select: { id: true },
      })
    ).id
    excludedTxnId = (
      await prisma.finTransaction.create({
        data: {
          ...base,
          txnDate: new Date('2026-01-12T00:00:00Z'),
          amount: 30000,
          description: '외부 계약 매출',
          identityKey: 'e2e-ex-excluded',
          contentHash: 'h-excluded',
        },
        select: { id: true },
      })
    ).id

    const otherAcct = await prisma.finAccount.create({
      data: { spaceId: OTHER_SPACE_ID, name: '남의계좌', kind: 'BANK', institution: '테스트은행' },
      select: { id: true },
    })
    otherSpaceTxnId = (
      await prisma.finTransaction.create({
        data: {
          spaceId: OTHER_SPACE_ID,
          accountId: otherAcct.id,
          direction: 'IN',
          txnDate: new Date('2026-01-10T00:00:00Z'),
          amount: 1,
          identityKey: 'e2e-ex-other',
          contentHash: 'h-other',
        },
        select: { id: true },
      })
    ).id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: SPACE_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('단건 PATCH 로 분석 제외 지정', async () => {
    const res = await txnPatch(
      jsonReq(`http://localhost/api/finance/transactions/${excludedTxnId}`, 'PATCH', {
        excludeFromAnalysis: true,
      }),
      { params: Promise.resolve({ id: excludedTxnId }) }
    )
    expect(res!.status).toBe(200)
    const json = await res!.json()
    expect(json.transaction.excludeFromAnalysis).toBe(true)
  })

  test('계정과목 재분류는 분석 제외 값을 바꾸지 않는다', async () => {
    const res = await txnPatch(
      jsonReq(`http://localhost/api/finance/transactions/${excludedTxnId}`, 'PATCH', {
        categoryId: otherIncomeCatId,
        learn: false,
      }),
      { params: Promise.resolve({ id: excludedTxnId }) }
    )
    expect(res!.status).toBe(200)
    const row = await prisma.finTransaction.findUnique({ where: { id: excludedTxnId } })
    expect(row!.excludeFromAnalysis).toBe(true)
    // 원복(이후 집계 테스트가 같은 계정과목을 가정)
    await prisma.finTransaction.update({
      where: { id: excludedTxnId },
      data: { categoryId: incomeCatId },
    })
  })

  test('bulk: 다른 space 의 id 는 무시, 자기 space 만 갱신', async () => {
    const res = await txnBulk(
      jsonReq('http://localhost/api/finance/transactions/bulk', 'POST', {
        ids: [normalTxnId, otherSpaceTxnId],
        excludeFromAnalysis: true,
      })
    )
    expect(res!.status).toBe(200)
    expect((await res!.json()).updated).toBe(1)
    const other = await prisma.finTransaction.findUnique({ where: { id: otherSpaceTxnId } })
    expect(other!.excludeFromAnalysis).toBe(false)
    // 해제도 같은 경로
    const res2 = await txnBulk(
      jsonReq('http://localhost/api/finance/transactions/bulk', 'POST', {
        ids: [normalTxnId],
        excludeFromAnalysis: false,
      })
    )
    expect((await res2!.json()).updated).toBe(1)
    const normal = await prisma.finTransaction.findUnique({ where: { id: normalTxnId } })
    expect(normal!.excludeFromAnalysis).toBe(false)
  })

  test.each(['DUP_CHANGED', 'DUP_OVERWRITE'] as const)(
    '재업로드(%s) 커밋 후에도 분석 제외 유지',
    async (resolution) => {
      const imp = await prisma.finImport.create({
        data: {
          spaceId: SPACE_ID,
          accountId,
          fileName: `re-${resolution}.csv`,
          institution: '테스트은행',
          kind: 'BANK',
          status: 'DRAFT',
        },
        select: { id: true },
      })
      await prisma.finStagedRow.create({
        data: {
          importId: imp.id,
          spaceId: SPACE_ID,
          accountId,
          raw: {},
          txnDate: new Date('2026-01-12T00:00:00Z'),
          direction: 'IN',
          amount: 30000,
          description: '외부 계약 매출(수정)',
          categoryId: incomeCatId,
          classStatus: 'CLASSIFIED',
          identityKey: 'e2e-ex-excluded',
          contentHash: `h-changed-${resolution}`,
          resolution,
        },
      })
      const res = await stagingCommit(
        jsonReq('http://localhost/api/finance/staging/commit', 'POST', { importId: imp.id })
      )
      expect(res!.status).toBe(200)
      expect((await res!.json()).committed).toBe(1)
      const row = await prisma.finTransaction.findUnique({ where: { id: excludedTxnId } })
      expect(row!.description).toBe('외부 계약 매출(수정)')
      expect(row!.excludeFromAnalysis).toBe(true)
    }
  )
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts`
Expected: FAIL — 단건 PATCH 가 400 "변경할 내용이 없습니다", bulk 가 400 "처리할 내용이 없습니다". 재업로드 2건은 이미 PASS(보존은 기존 upsert 구조가 보장 — 회귀 방지용).

- [ ] **Step 5: 단건 PATCH 구현**

`app/api/finance/transactions/[id]/route.ts`:

상단 주석 body 설명을 `body: { categoryId?, learn?(기본 true), isTransfer?, excludeFromAnalysis?, memo? }` 로 수정.

`data` 타입에 필드 추가:

```ts
    isTransfer?: boolean
    excludeFromAnalysis?: boolean
```

`if (typeof body?.isTransfer === 'boolean') data.isTransfer = body.isTransfer` 바로 아래:

```ts
// 분석 제외 — 계정과목과 독립(재분류가 건드리지 않음)
if (typeof body?.excludeFromAnalysis === 'boolean')
  data.excludeFromAnalysis = body.excludeFromAnalysis
```

`update` 의 `select` 에 `excludeFromAnalysis: true,` 추가(`isTransfer: true,` 아래).

- [ ] **Step 6: bulk 구현**

`app/api/finance/transactions/bulk/route.ts`:

상단 주석 목록에 한 줄 추가:

```ts
 *   - { ids, excludeFromAnalysis } → 일괄 분석 제외 지정(true)/해제(false)
```

`// ── 일괄 부채 상환 연결/해제 ──` 블록 바로 위에:

```ts
// ── 일괄 분석 제외 지정/해제 ──
if (typeof body?.excludeFromAnalysis === 'boolean') {
  const result = await prisma.finTransaction.updateMany({
    where: { id: { in: ids }, spaceId },
    data: { excludeFromAnalysis: body.excludeFromAnalysis },
  })
  return NextResponse.json({ updated: result.count })
}
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts`
Expected: PASS 5 tests (skipped 0).

- [ ] **Step 8: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations/*_finance_txn_exclude_from_analysis \
  "app/api/finance/transactions/[id]/route.ts" app/api/finance/transactions/bulk/route.ts \
  src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts
git commit -m "✨ feat(finance): 거래 분석 제외 컬럼 + 단건·일괄 지정 API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 집계 필터 (현금흐름·대시보드·Sankey·거래내역 요약) + export 컬럼

**Files:**

- Modify: `src/lib/finance/queries.ts` (`QueryTransactionsOptions` ~81, `queryTransactions` where ~183·sumWhere ~234·select ~254, `QueryCashflowOptions` ~304, `queryCashflow` findMany ~323, `QueryDashboardOptions` ~590, `queryDashboard` findMany ~653·return ~845)
- Modify: `app/api/finance/transactions/route.ts`, `app/api/finance/cashflow/route.ts`, `app/api/finance/dashboard/route.ts`, `app/api/finance/cashflow/sankey/route.ts`, `app/api/finance/export/route.ts`
- Test: `src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts` (describe 추가)

**Interfaces:**

- Consumes: Task 1 컬럼
- Produces: `QueryTransactionsOptions.scope?: 'all' | 'included' | 'excluded'`, `QueryTransactionsOptions.includeExcluded?: boolean`; 응답 행에 `excludeFromAnalysis: boolean`
- Produces: `QueryCashflowOptions.includeExcluded?: boolean`, `QueryDashboardOptions.includeExcluded?: boolean`
- Produces: 대시보드 응답 `excludedCount: number` (현재 기간, 이체 제외, `includeExcluded` 이면 0)
- Produces: 쿼리 파라미터 — `/api/finance/{cashflow,dashboard,cashflow/sankey,transactions}?includeExcluded=1`, `/api/finance/transactions?scope=included|excluded`

- [ ] **Step 1: 실패하는 테스트 추가**

`exclude-from-analysis.e2e.test.ts` 상단 import 에 추가:

```ts
import { GET as cashflowGet } from '../../../../app/api/finance/cashflow/route'
import { GET as dashboardGet } from '../../../../app/api/finance/dashboard/route'
import { GET as sankeyGet } from '../../../../app/api/finance/cashflow/sankey/route'
import { GET as transactionsGet } from '../../../../app/api/finance/transactions/route'
import { GET as exportGet } from '../../../../app/api/finance/export/route'
```

기존 `d(...)` 블록 맨 끝(마지막 `test.each` 뒤, 닫는 `})` 앞)에 추가. 이 시점 상태: normal(100,000, 미제외), excluded(30,000, 제외) — 둘 다 2026-01 INCOME.

```ts
describe('집계 필터', () => {
  const get = (url: string) => new NextRequest(url)
  beforeAll(async () => {
    // 이체이면서 분석 제외인 거래 — 어떤 경우에도 합계에 들어가면 안 된다(Review Focus 4)
    await prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        direction: 'IN',
        txnDate: new Date('2026-01-15T00:00:00Z'),
        amount: 7000,
        isTransfer: true,
        excludeFromAnalysis: true,
        identityKey: 'e2e-ex-transfer',
        contentHash: 'h-transfer',
      },
    })
  })

  test('현금흐름: 기본 제외, includeExcluded=1 이면 포함', async () => {
    const off = await (await cashflowGet(
      get('http://localhost/api/finance/cashflow?grain=month&periods=2026-01')
    ))!.json()
    expect(off.totals.income.values['2026-01']).toBe(100000)
    const on = await (await cashflowGet(
      get('http://localhost/api/finance/cashflow?grain=month&periods=2026-01&includeExcluded=1')
    ))!.json()
    expect(on.totals.income.values['2026-01']).toBe(130000)
  })

  test('대시보드: 수입 기본 제외 + excludedCount', async () => {
    const off = await (await dashboardGet(
      get('http://localhost/api/finance/dashboard?period=month&anchor=2026-01')
    ))!.json()
    expect(off.kpi.income).toBe(100000)
    expect(off.excludedCount).toBe(1) // 이체+제외 거래는 세지 않음
    const on = await (await dashboardGet(
      get('http://localhost/api/finance/dashboard?period=month&anchor=2026-01&includeExcluded=1')
    ))!.json()
    expect(on.kpi.income).toBe(130000)
    expect(on.excludedCount).toBe(0)
  })

  test('Sankey: 기본 제외, includeExcluded=1 이면 포함', async () => {
    const off = await (await sankeyGet(
      get('http://localhost/api/finance/cashflow/sankey?grain=month&period=2026-01')
    ))!.json()
    expect(off.totals.totalIncome).toBe(100000)
    const on = await (await sankeyGet(
      get(
        'http://localhost/api/finance/cashflow/sankey?grain=month&period=2026-01&includeExcluded=1'
      )
    ))!.json()
    expect(on.totals.totalIncome).toBe(130000)
  })

  test('거래내역: scope 별 행 + 요약 합계 규칙', async () => {
    const q = 'http://localhost/api/finance/transactions?from=2026-01-01&to=2026-01-31'
    const all = await (await transactionsGet(get(q)))!.json()
    expect(all.total).toBe(3) // 행은 전부(이체 포함)
    expect(all.summary.incomeTotal).toBe(100000) // 요약은 분석 제외·이체 뺌
    expect(all.rows.find((r: { id: string }) => r.id === excludedTxnId).excludeFromAnalysis).toBe(
      true
    )

    const included = await (await transactionsGet(get(`${q}&scope=included`)))!.json()
    expect(included.total).toBe(1)
    expect(included.summary.incomeTotal).toBe(100000)

    const excluded = await (await transactionsGet(get(`${q}&scope=excluded`)))!.json()
    expect(excluded.total).toBe(2) // excluded + transferExcluded
    expect(excluded.summary.incomeTotal).toBe(30000) // 이체는 여전히 합계 제외

    const withInc = await (await transactionsGet(get(`${q}&includeExcluded=1`)))!.json()
    expect(withInc.summary.incomeTotal).toBe(130000)
  })

  test('export: 분석 제외 컬럼', async () => {
    const res = await exportGet(
      get('http://localhost/api/finance/export?from=2026-01-01&to=2026-01-31')
    )
    const csv = await res!.text()
    const [header, ...lines] = csv.replace(/^﻿/, '').split('\r\n')
    // cell() 은 모든 값을 "..." 로 감싼다
    expect(header.split(',')).toContain('"분석제외"')
    const line = lines.find((l) => l.includes('외부 계약 매출'))!
    expect(line.split(',').at(-1)).toBe('"Y"')
    const normalLine = lines.find((l) => l.includes('본업 매출'))!
    expect(normalLine.split(',').at(-1)).toBe('""')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts -t '집계 필터'`
Expected: FAIL — 현금흐름 off 값 130000(필터 미적용), `excludedCount` undefined 등.

- [ ] **Step 3: `queryTransactions` 구현 (`src/lib/finance/queries.ts`)**

`QueryTransactionsOptions` 의 `excludeTransfer?: boolean` 아래에 추가:

```ts
  /** 분석 제외 행 범위 — all(기본)=전부, included=분석 대상만, excluded=분석 제외만. */
  scope?: 'all' | 'included' | 'excluded' | null
  /**
   * 요약 합계에 분석 제외 거래를 포함(현금흐름 토글 on 에서 온 드릴다운). 기본 false —
   * 요약은 현금흐름 기본 정의(분석 제외 빼고)와 일치시킨다. scope=excluded 면 자동 포함.
   */
  includeExcluded?: boolean
```

`where` 객체에서 `...(opts.excludeTransfer === true ? { isTransfer: false } : {}),` 아래에 추가:

```ts
    ...(opts.scope === 'included'
      ? { excludeFromAnalysis: false }
      : opts.scope === 'excluded'
        ? { excludeFromAnalysis: true }
        : {}),
```

`const sumWhere = { ...where, isTransfer: false }` 를 교체:

```ts
// 요약 집계(incomeTotal/expenseTotal)는 이체를 제외한다 — 대시보드·현금흐름과 정의 일치.
// 분석 제외도 기본 제외(현금흐름 기본값과 일치). 분석 제외만 보는 중이거나 포함 토글이면 유지.
// 행 목록(where)은 변경 없이 이체 행을 계속 표시하며, excludeTransfer=1 파라미터로 별도 제어.
const keepExcludedInSums = opts.scope === 'excluded' || opts.includeExcluded === true
const sumWhere = {
  ...where,
  isTransfer: false,
  ...(keepExcludedInSums ? {} : { excludeFromAnalysis: false }),
}
```

`findMany` select 의 `isTransfer: true,` 아래에 `excludeFromAnalysis: true,` 추가.

- [ ] **Step 4: `queryCashflow` 구현**

`QueryCashflowOptions` 에 추가:

```ts
  /** 분석 제외 거래 포함 여부. 기본 false(제외). 계정과목 제외(exclude)와 별개 — 거래 단위. */
  includeExcluded?: boolean
```

`queryCashflow` 의 거래 `findMany` where 를 교체:

```ts
      where: {
        spaceId,
        txnDate: { gte, lt },
        ...(opts.includeExcluded ? {} : { excludeFromAnalysis: false }),
      },
```

- [ ] **Step 5: `queryDashboard` 구현**

`QueryDashboardOptions` 에 `includeExcluded?: boolean` 추가(같은 주석).

`Promise.all` 의 **첫 번째** `prisma.finTransaction.findMany`(수입/지출 `txns`) where 만 교체 — `repaymentTxns` 는 그대로:

```ts
      where: {
        spaceId,
        txnDate: { gte, lt },
        ...(opts.includeExcluded ? {} : { excludeFromAnalysis: false }),
      },
```

`Promise.all` 뒤(`const rows: AggRow[] = ...` 위)에 추가:

```ts
// 현재 기간에서 빠진 분석 제외 건수(이체 제외) — 잔액 변동과 수입−지출 불일치 안내용.
const curRange = rangeBounds(curMonths[0], curEndYm)
const excludedCount = opts.includeExcluded
  ? 0
  : await prisma.finTransaction.count({
      where: {
        spaceId,
        isTransfer: false,
        excludeFromAnalysis: true,
        txnDate: { gte: curRange.gte, lt: curRange.lt },
      },
    })
```

return 객체의 `liabilities: liabilityList,` 아래에 `excludedCount,` 추가.

- [ ] **Step 6: 라우트 파라미터 파싱**

`app/api/finance/cashflow/route.ts`: 주석 query 설명에 `includeExcluded?(1=분석 제외 거래 포함)` 추가, 호출을

```ts
const includeExcluded = sp.get('includeExcluded') === '1'

return NextResponse.json(await queryCashflow(spaceId, { grain, periods, exclude, includeExcluded }))
```

`app/api/finance/dashboard/route.ts`: 주석 동일 추가, 호출을

```ts
return NextResponse.json(
  await queryDashboard(spaceId, {
    period,
    anchor: sp.get('anchor'),
    includeExcluded: sp.get('includeExcluded') === '1',
  })
)
```

`app/api/finance/transactions/route.ts`: 주석에 `scope?(all|included|excluded), includeExcluded?(1)` 추가, `excludeTransfer:` 줄 아래에

```ts
      scope: (['included', 'excluded'] as const).find((s) => s === sp.get('scope')) ?? 'all',
      includeExcluded: sp.get('includeExcluded') === '1',
```

`app/api/finance/cashflow/sankey/route.ts`: 주석에 `includeExcluded?(1)` 추가. 거래 `findMany` where 를

```ts
      where: {
        spaceId,
        txnDate: { gte, lt },
        ...(sp.get('includeExcluded') === '1' ? {} : { excludeFromAnalysis: false }),
      },
```

- [ ] **Step 7: export 컬럼**

`app/api/finance/export/route.ts`: select 의 `isTransfer: true,` 아래 `excludeFromAnalysis: true,`. `headers` 배열 끝(`'현금흐름분류',` 뒤)에 `'분석제외',`. 행 배열 끝(`cell(cf),` 뒤)에 `cell(t.excludeFromAnalysis ? 'Y' : ''),`. 행 필터는 추가하지 않는다.

- [ ] **Step 8: 테스트 통과 + 타입 확인**

Run: `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts`
Expected: PASS 10 tests.
Run: `npx tsc --noEmit -p .` — Expected: 새 에러 0 (MCP `src/lib/agent/tools/finance-tools.ts` 는 옵션 미전달 → 기본 제외 상속, 수정 불필요).
Run: `npx jest src/lib/finance` — Expected: 기존 단위 테스트 전부 PASS.

- [ ] **Step 9: 커밋**

```bash
git add src/lib/finance/queries.ts app/api/finance/transactions/route.ts \
  app/api/finance/cashflow/route.ts app/api/finance/dashboard/route.ts \
  app/api/finance/cashflow/sankey/route.ts app/api/finance/export/route.ts \
  src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts
git commit -m "✨ feat(finance): 분석 제외 거래 집계 기본 제외 + includeExcluded 토글 파라미터

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 거래내역 화면 — 범위 필터·배지·일괄 지정

**Files:**

- Modify: `src/components/finance/transactions-view.tsx`

**Interfaces:**

- Consumes: `GET /api/finance/transactions?scope=&includeExcluded=1`, 행의 `excludeFromAnalysis`, `POST /api/finance/transactions/bulk { ids, excludeFromAnalysis }`
- Produces: 거래내역 URL 딥링크 파라미터 `scope`, `includeExcluded` 를 초기 상태로 읽음 (Task 4 의 딥링크가 사용)

UI 컴포넌트라 자동 테스트 대신 Step 6 수동 검증으로 확인한다(이 파일엔 RTL 테스트가 없다).

- [ ] **Step 1: 타입·상태**

`type Transaction` 의 `isTransfer: boolean` 아래 `excludeFromAnalysis: boolean` 추가.

`filterExcludeTransfer` state 선언 바로 아래:

```tsx
// 분석 제외 범위 — 전체/분석 대상/분석 제외. 현금흐름 딥링크(scope=included)가 초기값을 준다.
const [filterScope, setFilterScope] = useState<'all' | 'included' | 'excluded'>(() => {
  const s = searchParams.get('scope')
  return s === 'included' || s === 'excluded' ? s : 'all'
})
// 현금흐름 토글 on 상태에서 온 딥링크 — 요약 합계에 분석 제외 포함(셀 값과 일치). 화면 조작 없음.
const linkIncludeExcluded = searchParams.get('includeExcluded') === '1'
```

`hasDeepLink` 의 키 배열에 `'scope'` 추가.

- [ ] **Step 2: 조회 파라미터**

`loadTransactions` 의 `if (filterExcludeTransfer) params.set('excludeTransfer', '1')` 아래:

```tsx
if (filterScope !== 'all') params.set('scope', filterScope)
if (linkIncludeExcluded) params.set('includeExcluded', '1')
```

의존성 배열에 `filterScope, linkIncludeExcluded` 추가.

`toggleExcludeTransfer` 아래:

```tsx
const changeScope = useCallback((next: 'all' | 'included' | 'excluded') => {
  setFilterScope(next)
  setFilterReloadTick((t) => t + 1)
}, [])
```

- [ ] **Step 3: 일괄 지정 핸들러**

`handleTxnBulkLinkLiability` 아래:

```tsx
// 분석 제외 일괄 지정/해제 — 단건 해제(배지 X)도 이 경로를 쓴다.
const handleTxnBulkExclude = useCallback(
  async (ids: string[], excludeFromAnalysis: boolean) => {
    try {
      const res = await fetch('/api/finance/transactions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, excludeFromAnalysis }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message ?? '처리 실패')
      toast.success(
        excludeFromAnalysis
          ? `${data.updated ?? 0}건을 분석 제외로 지정했습니다`
          : `${data.updated ?? 0}건의 분석 제외를 해제했습니다`
      )
      void loadTransactions()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '처리 실패')
    }
  },
  [loadTransactions]
)
```

- [ ] **Step 4: props 배선**

`<TransactionsPanel ...>` 에 추가: `filterScope={filterScope}`, `onScopeChange={changeScope}`, `onBulkExclude={handleTxnBulkExclude}`.

`TransactionsPanel` 구조분해·타입에 추가:

```tsx
  filterScope: 'all' | 'included' | 'excluded'
  onScopeChange: (next: 'all' | 'included' | 'excluded') => void
  onBulkExclude: (ids: string[], excludeFromAnalysis: boolean) => Promise<void>
```

`runBulkLinkLiability` 아래:

```tsx
const runBulkExclude = async (excludeFromAnalysis: boolean) => {
  await onBulkExclude(selectedInView, excludeFromAnalysis)
  clearSelection()
}
```

`<TransactionsBulkBar ...>` 에 `onExclude={runBulkExclude}` 추가. `<TransactionRow ...>` 에 `onUnexclude={() => void onBulkExclude([txn.id], false)}` 추가(행 map 변수명이 `txn` 이 아니면 그 이름으로).

- [ ] **Step 5: UI 요소**

(a) 필터 바 — 「이체 제외」 `<label>` 바로 앞에:

```tsx
{
  /* 분석 제외 범위 — 개인·외부계약 등 분석 제외로 지정한 거래 필터. 합계는 기본으로 분석 제외를 뺀다. */
}
;<div className="flex items-center gap-1.5">
  <span className="text-xs text-muted-foreground">분석</span>
  <Select
    value={filterScope}
    onValueChange={(v) => onScopeChange(v as 'all' | 'included' | 'excluded')}
  >
    <SelectTrigger className="h-8 w-28 text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">전체</SelectItem>
      <SelectItem value="included">분석 대상</SelectItem>
      <SelectItem value="excluded">분석 제외</SelectItem>
    </SelectContent>
  </Select>
</div>
```

(b) 합계 요약(`{/* 합계 요약 */}` 블록) 라벨 옆에 `InfoHint`(`@/components/finance/info-hint` import 추가):

```tsx
<InfoHint content="분석 제외로 지정한 거래와 이체는 합계에서 빠집니다. 「분석: 분석 제외」를 고르면 분석 제외 거래 합계를 봅니다." />
```

요약 블록 구조를 읽고 첫 라벨 뒤에 둔다.

(c) `TransactionsBulkBar` props 에 `onExclude: (excludeFromAnalysis: boolean) => Promise<void>` 추가하고, 삭제 `<Button>` 바로 앞에:

```tsx
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-xs text-background hover:bg-background/10"
            onClick={() => void run(() => onExclude(true))}
            disabled={busy}
          >
            분석 제외 지정
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-xs text-background/70 hover:bg-background/10"
            onClick={() => void run(() => onExclude(false))}
            disabled={busy}
          >
            분석 제외 해제
          </Button>
```

(d) `TransactionRow` props 에 `onUnexclude: () => void` 추가. 적요 셀의 `{txn.liability && (...)}` 뒤에(부채 배지와 같은 패턴):

```tsx
{
  txn.excludeFromAnalysis && (
    <span className="mt-0.5 ml-1 inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
      분석 제외
      <button
        type="button"
        onClick={onUnexclude}
        aria-label="분석 제외 해제"
        className="ml-0.5 rounded-full hover:bg-background"
      >
        <X className="size-2.5" />
      </button>
    </span>
  )
}
```

단건 지정은 행 체크박스 선택 → 일괄 바 「분석 제외 지정」으로 한다(행 메뉴는 이 파일에 없음 — 새로 만들지 않는다).

- [ ] **Step 6: 검증**

Run: `npm run lint -- src/components/finance/transactions-view.tsx` → 에러 0.
Run: `npx tsc --noEmit -p .` → 새 에러 0.
수동(`npm run dev`, 로컬 dev QA 로그인): `/d/finance/transactions`

1. 행 2개 선택 → 「분석 제외 지정」 → 토스트 「2건을…」, 배지 표시, 요약 수입/지출이 그만큼 감소.
2. 「분석: 분석 제외」 → 그 2건만, 요약 = 그 2건 합계.
3. 배지 X → 해제, 요약 복원.
4. `?scope=included` 로 직접 진입 → 필터가 「분석 대상」으로 시작.

- [ ] **Step 7: 커밋**

```bash
git add src/components/finance/transactions-view.tsx
git commit -m "✨ feat(finance): 거래내역 분석 제외 필터·배지·일괄 지정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 현금흐름 — 「분석 제외 거래 포함」 토글 + 패널·딥링크·흐름도 연동

**Files:**

- Modify: `src/components/finance/cashflow-view.tsx` (URL 상태 ~277, `fetchCashflow` ~300, `load`/`refreshData`/effect ~319-336, 컨트롤 ~430, 흐름도·패널 렌더 ~455-485, `buildTxnDeepLink` ~1308, `CashflowTxnPanel` ~1363·load ~1427·딥링크 사용 ~1469)
- Modify: `src/components/finance/cashflow-sankey.tsx` (~130-140)

**Interfaces:**

- Consumes: `/api/finance/cashflow?includeExcluded=1`, `/api/finance/cashflow/sankey?includeExcluded=1`, `/api/finance/transactions?scope=included|includeExcluded=1`, 거래내역 딥링크 `scope`·`includeExcluded` (Task 3)

- [ ] **Step 1: URL 상태**

`setExcluded` 정의 아래:

```tsx
// 분석 제외 거래 포함 — URL(?includeExcluded=1) 단일 소스. 계정 제외(?exclude=)와 별개(거래 단위).
const includeExcluded = searchParams.get('includeExcluded') === '1'
const setIncludeExcluded = useCallback(
  (next: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set('includeExcluded', '1')
    else params.delete('includeExcluded')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  },
  [pathname, router, searchParams]
)
```

- [ ] **Step 2: 표 조회에 전달**

`fetchCashflow` 시그니처를 `(g: Grain, periods: string[], exclude: string, incl: boolean, showLoading: boolean)` 로 바꾸고 `if (exclude) qs.set('exclude', exclude)` 아래에 `if (incl) qs.set('includeExcluded', '1')`.

`load` 를 `(g, periods, exclude, incl: boolean)` 로 바꿔 `fetchCashflow(g, periods, exclude, incl, true)`.
`refreshData` 를 `fetchCashflow(grain, selectedPeriods, excludeParam, includeExcluded, false)` + 의존성에 `includeExcluded`.
effect 를 `void load(grain, selectedPeriods, excludeParam, includeExcluded)` + 의존성에 `includeExcluded`.

- [ ] **Step 3: 토글 UI**

컨트롤 바에서 `{view === 'table' && (...)}` / `{view === 'flow' && (...)}` 두 블록 **밖**(둘 다 뒤, 컨트롤 `</div>` 직전)에 — 표·흐름도 공통:

```tsx
{
  /* 분석 제외 거래 포함 — 기본 off(분석 제외 거래는 표·손익 지표·흐름도에서 빠짐). */
}
;<label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
  <Checkbox
    checked={includeExcluded}
    onCheckedChange={(v) => setIncludeExcluded(v === true)}
    aria-label="분석 제외 거래 포함"
  />
  분석 제외 거래 포함
</label>
```

`ExcludeFilter` 트리거 버튼 문구가 「제외」만이면 「계정 제외」로 바꾼다(`ExcludeFilter` 함수 ~509 내부 트리거 텍스트). 이미 계정 맥락이 드러나는 문구면 그대로 둔다.

- [ ] **Step 4: 흐름도 전달**

`<FinanceCashflowSankey grain={grain} period={flowPeriod} />` → `<FinanceCashflowSankey grain={grain} period={flowPeriod} includeExcluded={includeExcluded} />`.

`cashflow-sankey.tsx`:

```tsx
export function FinanceCashflowSankey({
  grain,
  period,
  includeExcluded,
}: {
  grain: Grain
  period: string
  includeExcluded: boolean
}) {
```

`load` 를 `async (g: Grain, p: string, incl: boolean)` 로 바꾸고 `qs` 생성 뒤 `if (incl) qs.set('includeExcluded', '1')`. 이 `load` 를 호출하는 effect 를 찾아 세 번째 인자 `includeExcluded` 와 의존성 추가.

- [ ] **Step 5: 드릴다운 패널·딥링크**

`<CashflowTxnPanel ...>` 에 `includeExcluded={includeExcluded}` 추가. `CashflowTxnPanel` props·타입에 `includeExcluded: boolean` 추가.

패널 `load` 의 `params` 생성 뒤:

```tsx
// 표 셀과 같은 모집단 — 토글 off 면 분석 대상만, on 이면 전부 + 합계 포함.
if (includeExcluded) params.set('includeExcluded', '1')
else params.set('scope', 'included')
```

`load` 의 `useCallback` 의존성에 `includeExcluded` 추가.

`buildTxnDeepLink(selected, from, to)` → `buildTxnDeepLink(selected, from, to, includeExcluded)`. 함수 시그니처에 `includeExcluded: boolean` 추가, `p` 생성 뒤:

```tsx
if (includeExcluded) p.set('includeExcluded', '1')
else p.set('scope', 'included')
```

- [ ] **Step 6: 검증**

Run: `npm run lint -- src/components/finance/cashflow-view.tsx src/components/finance/cashflow-sankey.tsx` → 에러 0.
Run: `npx tsc --noEmit -p .` → 새 에러 0.
수동(Task 3 에서 지정한 거래가 있는 월):

1. `/d/finance/cashflow` 기본 → 해당 계정 셀 값이 분석 제외만큼 작다.
2. 셀 클릭 → 우측 패널 행 합계 = 셀 값(분석 제외 행 없음).
3. 「분석 제외 거래 포함」 체크 → URL 에 `includeExcluded=1`, 셀·패널 둘 다 증가·일치. 새로고침 후 유지.
4. 패널의 거래내역 이동 링크 → 거래내역 화면 요약 합계 = 셀 값(토글 on/off 각각).
5. 흐름도 뷰에서 토글 on/off → 총수입 변화.
6. 「계정 제외」로 계정 하나 제외 + 토글 on 동시 → 둘 다 적용(서로 덮어쓰지 않음).

- [ ] **Step 7: 커밋**

```bash
git add src/components/finance/cashflow-view.tsx src/components/finance/cashflow-sankey.tsx
git commit -m "✨ feat(finance): 현금흐름 분석 제외 거래 포함 토글 + 패널·흐름도 연동

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 대시보드 — 토글 + 분석 제외 건수 안내

**Files:**

- Modify: `src/components/finance/dashboard-view.tsx` (`DashboardData` ~96, state ~232, `load` ~250, 컨트롤 ~362-395, 수입 카드 ~439)

**Interfaces:**

- Consumes: `/api/finance/dashboard?includeExcluded=1`, 응답 `excludedCount: number` (Task 2)

대시보드는 URL 쿼리를 쓰지 않는 화면(`useSearchParams` 미사용)이라 로컬 state 로 둔다 — `useSearchParams` 도입 시 Suspense 경계가 추가로 필요하다(spec §7 의 URL 방식에서 의도적으로 단순화).

- [ ] **Step 1: 타입·상태·조회**

`DashboardData` 에 `excludedCount: number` 추가.
`const [anchor, ...]` 아래:

```tsx
// 분석 제외 거래 포함 — 기본 off. 잔액(스냅샷)은 항상 전체 기준이라 영향 없음.
const [includeExcluded, setIncludeExcluded] = useState(false)
```

`load` 의 `params` 생성 뒤 `if (includeExcluded) params.set('includeExcluded', '1')`, 의존성 `[period, anchor, includeExcluded]`.

- [ ] **Step 2: 토글 UI**

상단 컨트롤의 앵커 이동 `<div className="flex items-center gap-1">…</div>` 뒤에(`Checkbox` import 추가: `import { Checkbox } from '@/components/ui/checkbox'`):

```tsx
<label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
  <Checkbox
    checked={includeExcluded}
    onCheckedChange={(v) => setIncludeExcluded(v === true)}
    aria-label="분석 제외 거래 포함"
  />
  분석 제외 거래 포함
</label>
```

- [ ] **Step 3: 제외 건수 안내**

수입 카드의 `<CardTitle ...>수입</CardTitle>` 을 다음으로 교체(`InfoHint` import 추가: `import { InfoHint } from '@/components/finance/info-hint'`):

```tsx
<CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
  수입
  {data.excludedCount > 0 && (
    <InfoHint
      content={`분석 제외 거래 ${data.excludedCount}건이 수입·지출에서 빠졌습니다. 총현금(잔액)은 실제 잔액이라 포함되므로 수입−지출과 잔액 변동이 다를 수 있습니다.`}
    />
  )}
</CardTitle>
```

- [ ] **Step 4: 검증**

Run: `npm run lint -- src/components/finance/dashboard-view.tsx` → 에러 0.
Run: `npx tsc --noEmit -p .` → 새 에러 0.
수동: `/d/finance/dashboard` 에서 분석 제외 거래가 있는 월 → 수입 옆 ⓘ 안내, 토글 on → 수입 증가·ⓘ 사라짐, 총현금 값은 토글과 무관하게 동일.

- [ ] **Step 5: 커밋**

```bash
git add src/components/finance/dashboard-view.tsx
git commit -m "✨ feat(finance): 대시보드 분석 제외 토글 + 제외 건수 안내

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 전체 검증 + spec 동기화

**Files:**

- Modify: `docs/superpowers/specs/2026-10-05-finance-exclude-from-analysis-design.md` (구현 중 단순화 반영)

- [ ] **Step 1: spec 동기화**

spec 에 반영:

- §6 「행 메뉴」 → 「행 배지의 X 로 해제, 지정은 행 선택 후 일괄 바」.
- §7 대시보드 토글 상태 = 로컬 state(URL 아님), 이유: 대시보드는 `useSearchParams` 미사용.
- §8 컬럼명 「분석제외」(Y/공란).

- [ ] **Step 2: 전체 검증**

Run: `npm run lint` → 에러 0.
Run: `npx jest src/lib/finance` → PASS.
Run: `npx jest -c jest.config.e2e.ts src/lib/finance/__tests__/exclude-from-analysis.e2e.test.ts src/lib/__tests__/finance-commit-snapshot.e2e.test.ts src/lib/__tests__/finance-classify-refund.e2e.test.ts` → PASS(skipped 0).
Run: `npm run build` (run_in_background) → 성공.
변경 파일에 `TODO`·`test.skip`·`.only` 없는지: `git diff origin/main --stat` 후 `git diff origin/main | grep -nE "TODO|test\.skip|\.only\(" ` → 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-10-05-finance-exclude-from-analysis-design.md
git commit -m "📝 docs(finance): 분석 제외 spec 구현 반영

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

릴리스(develop → main)는 이 계획 범위 밖 — 워크트리→develop→main 단계 정책을 따른다.
