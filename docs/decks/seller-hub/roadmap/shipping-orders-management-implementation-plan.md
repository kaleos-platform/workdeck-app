# 배송 데이터 관리 사용성 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완료일 기간에 해당하는 배송 묶음을 한 번에 조회하고, 넓은 화면에서는 묶음·주문을 좌우로 배치하며, 두 주문 검색에서 결제금액 부분 검색을 지원한다.

**Architecture:** 배송 묶음 API에 검증된 KST `from`/`to` 범위를 추가하되 날짜가 없는 기존 pagination 계약은 유지한다. UI는 `2xl` breakpoint에서 280px 왼쪽 panel과 가변 오른쪽 panel로 전환하고 local collapse state만 둔다. 결제금액 matching은 작은 pure helper 하나를 두 검색 API가 공유한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma, Tailwind CSS, Jest, React Testing Library

---

## 파일 구조

- Modify: `src/lib/date-range.ts` — 엄격한 `YYYY-MM-DD` KST instant parsing 제공
- Create: `src/lib/__tests__/date-range.test.ts` — 유효 날짜·존재하지 않는 날짜·KST 경계 회귀 test
- Modify: `app/api/sh/shipping/batches/route.ts` — 기간 조회와 legacy pagination 분기
- Create: `app/api/sh/shipping/batches/__tests__/route.test.ts` — route 입력 검증·Prisma query·legacy 계약 test
- Create: `src/lib/sh/order-search.ts` — 결제금액 검색어 정규화와 부분 matching
- Create: `src/lib/sh/__tests__/order-search.test.ts` — 금액 표현별 matching test
- Modify: `app/api/sh/shipping/orders/route.ts` — 전체 검색에 결제금액 포함
- Modify: `app/api/sh/shipping/batches/[batchId]/orders/route.ts` — 묶음 내 검색에 결제금액 포함
- Modify: `src/components/sh/shipping/order-search-bar.tsx` — 전체 검색 placeholder 갱신
- Modify: `src/components/sh/shipping/order-detail-table.tsx` — 묶음 검색 placeholder 갱신
- Modify: `src/components/sh/shipping/batch-list.tsx` — server 기간 조회, 완료일 표시, 선택 해제, collapse control
- Create: `src/components/sh/shipping/__tests__/batch-list.test.tsx` — 요청·완료일·선택 해제·collapse 회귀 test
- Modify: `app/d/seller-ops/shipping/orders/page.tsx` — `2xl` 좌우 grid와 collapsed recovery rail

## Task 1: KST 날짜 parsing과 배송 묶음 기간 API

**Files:**
- Modify: `src/lib/date-range.ts`
- Create: `src/lib/__tests__/date-range.test.ts`
- Modify: `app/api/sh/shipping/batches/route.ts`
- Create: `app/api/sh/shipping/batches/__tests__/route.test.ts`

- [ ] **Step 1: 엄격한 KST 날짜 parsing 실패 test 작성**

```ts
// src/lib/__tests__/date-range.test.ts
import { parseYmdDateKst } from '@/lib/date-range'

describe('parseYmdDateKst', () => {
  test('KST 자정을 UTC instant로 변환한다', () => {
    expect(parseYmdDateKst('2026-09-24')?.toISOString()).toBe('2026-09-23T15:00:00.000Z')
  })

  test.each(['2026-02-30', '2026-13-01', '2026-9-24', 'invalid'])(
    '존재하지 않거나 형식이 잘못된 날짜 %s를 거부한다',
    (value) => expect(parseYmdDateKst(value)).toBeNull()
  )
})
```

- [ ] **Step 2: 날짜 test가 실패하는지 확인**

Run: `npm test -- src/lib/__tests__/date-range.test.ts --runInBand`

Expected: `parseYmdDateKst is not a function` 또는 export 부재로 FAIL.

- [ ] **Step 3: 최소 KST parsing 구현**

```ts
// src/lib/date-range.ts
export function parseYmdDateKst(value: string): Date | null {
  if (!isYmdDateString(value)) return null
  const date = new Date(`${value}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return null
  return formatDateToYmdKst(date) === value ? date : null
}
```

- [ ] **Step 4: 날짜 test 통과 확인**

Run: `npm test -- src/lib/__tests__/date-range.test.ts --runInBand`

Expected: 2 tests PASS.

- [ ] **Step 5: 배송 묶음 route의 실패 test 작성**

```ts
// app/api/sh/shipping/batches/__tests__/route.test.ts
/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) =>
    new Response(JSON.stringify({ message }), { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { delBatch: { findMany: jest.fn(), count: jest.fn() } },
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const mockResolve = resolveDeckContext as jest.Mock
const mockBatch = prisma.delBatch as unknown as {
  findMany: jest.Mock
  count: jest.Mock
}

describe('GET /api/sh/shipping/batches', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolve.mockResolvedValue({ space: { id: 'space-1' } })
    mockBatch.findMany.mockResolvedValue([])
    mockBatch.count.mockResolvedValue(0)
  })

  test('KST 완료일 기간을 적용하고 pagination 없이 조회한다', async () => {
    const req = new NextRequest(
      'http://localhost/api/sh/shipping/batches?status=COMPLETED&from=2026-09-17&to=2026-09-24'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockBatch.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: 'space-1',
        status: 'COMPLETED',
        completedAt: {
          gte: new Date('2026-09-16T15:00:00.000Z'),
          lt: new Date('2026-09-24T15:00:00.000Z'),
        },
      },
      orderBy: { completedAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    })
    expect(mockBatch.count).not.toHaveBeenCalled()
  })

  test.each([
    'from=2026-09-17',
    'from=2026-02-30&to=2026-03-01',
    'from=2026-09-25&to=2026-09-24',
  ])('잘못된 기간 %s를 400으로 거부한다', async (query) => {
    const res = await GET(
      new NextRequest(`http://localhost/api/sh/shipping/batches?status=COMPLETED&${query}`)
    )
    expect(res.status).toBe(400)
    expect(mockBatch.findMany).not.toHaveBeenCalled()
  })

  test('날짜가 없으면 기존 pagination 계약을 유지한다', async () => {
    await GET(
      new NextRequest(
        'http://localhost/api/sh/shipping/batches?status=COMPLETED&page=2&pageSize=20'
      )
    )
    expect(mockBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20, orderBy: { createdAt: 'desc' } })
    )
    expect(mockBatch.count).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: route test가 현재 동작에서 실패하는지 확인**

Run: `npm test -- app/api/sh/shipping/batches/__tests__/route.test.ts --runInBand`

Expected: 기간 query가 `completedAt`에 반영되지 않고 `skip`/`take`가 호출되어 FAIL.

- [ ] **Step 7: 기간 분기를 최소 구현**

`app/api/sh/shipping/batches/route.ts`에서 `where`를 `Prisma.DelBatchWhereInput`으로 명시하고 다음 분기를 기존 paginated query 앞에 둔다.

```ts
import type { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { parseYmdDateKst } from '@/lib/date-range'

const fromParam = req.nextUrl.searchParams.get('from')
const toParam = req.nextUrl.searchParams.get('to')
const hasDateParam = fromParam !== null || toParam !== null

const where: Prisma.DelBatchWhereInput = { spaceId: resolved.space.id }
if (status === 'DRAFT' || status === 'COMPLETED') where.status = status

if (hasDateParam) {
  if (!fromParam || !toParam) return errorResponse('from, to 쿼리 파라미터가 필요합니다', 400)
  const from = parseYmdDateKst(fromParam)
  const to = parseYmdDateKst(toParam)
  if (!from || !to) return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  if (from > to) return errorResponse('from이 to보다 이후일 수 없습니다', 400)

  const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000)
  where.completedAt = { gte: from, lt: toExclusive }
  const data = await prisma.delBatch.findMany({
    where,
    orderBy: { completedAt: 'desc' },
    include: { _count: { select: { orders: true } } },
  })
  return NextResponse.json({
    data: data.map(toBatchResponse),
    total: data.length,
    page: 1,
    pageSize: data.length,
  })
}
```

기존 response mapping은 다음 local function으로 한 번만 추출해 기간·legacy 분기가 공유하게 한다.

```ts
type BatchWithCount = Prisma.DelBatchGetPayload<{
  include: { _count: { select: { orders: true } } }
}>

function toBatchResponse(batch: BatchWithCount) {
  return {
    id: batch.id,
    status: batch.status,
    source: batch.source,
    label: batch.label,
    orderCount: batch._count.orders,
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
  }
}
```

- [ ] **Step 8: 날짜와 route test 통과 확인**

Run: `npm test -- src/lib/__tests__/date-range.test.ts app/api/sh/shipping/batches/__tests__/route.test.ts --runInBand`

Expected: 두 suite의 모든 test PASS.

- [ ] **Step 9: Task 1 commit**

```bash
git add src/lib/date-range.ts src/lib/__tests__/date-range.test.ts app/api/sh/shipping/batches/route.ts app/api/sh/shipping/batches/__tests__/route.test.ts
git commit -m "🐛 fix(sh): 배송 묶음 완료일 기간 조회 수정"
```

## Task 2: 결제금액 검색을 두 API에 공유

**Files:**
- Create: `src/lib/sh/order-search.ts`
- Create: `src/lib/sh/__tests__/order-search.test.ts`
- Modify: `app/api/sh/shipping/orders/route.ts`
- Modify: `app/api/sh/shipping/batches/[batchId]/orders/route.ts`
- Modify: `src/components/sh/shipping/order-search-bar.tsx`
- Modify: `src/components/sh/shipping/order-detail-table.tsx`

- [ ] **Step 1: 금액 matching 실패 test 작성**

```ts
// src/lib/sh/__tests__/order-search.test.ts
import { matchesPaymentAmount } from '@/lib/sh/order-search'

describe('matchesPaymentAmount', () => {
  test.each(['390', '39000', '39,000', '39 000', '39,000원'])(
    '%s로 39,000원을 부분 검색한다',
    (query) => expect(matchesPaymentAmount('39000', query)).toBe(true)
  )

  test.each(['상품39000', '원39000', ''])('%s는 금액 검색어로 해석하지 않는다', (query) => {
    expect(matchesPaymentAmount('39000', query)).toBe(false)
  })

  test('null 금액은 검색하지 않는다', () => {
    expect(matchesPaymentAmount(null, '39000')).toBe(false)
  })
})
```

- [ ] **Step 2: helper test가 실패하는지 확인**

Run: `npm test -- src/lib/sh/__tests__/order-search.test.ts --runInBand`

Expected: module 부재로 FAIL.

- [ ] **Step 3: 금액 검색 pure helper 구현**

```ts
// src/lib/sh/order-search.ts
function normalizePaymentQuery(query: string): string | null {
  const compact = query.trim().replace(/[\s,]/g, '').replace(/원$/, '')
  return /^\d+(?:\.\d+)?$/.test(compact) ? compact : null
}

export function matchesPaymentAmount(amount: unknown, query: string): boolean {
  if (amount == null) return false
  const normalizedQuery = normalizePaymentQuery(query)
  if (!normalizedQuery) return false
  const normalizedAmount = String(amount).replace(/[\s,]/g, '')
  return normalizedAmount.includes(normalizedQuery)
}
```

- [ ] **Step 4: helper test 통과 확인**

Run: `npm test -- src/lib/sh/__tests__/order-search.test.ts --runInBand`

Expected: 9 tests PASS.

- [ ] **Step 5: 두 검색 route가 helper를 사용하도록 수정**

두 route에 다음 import를 추가한다.

```ts
import { matchesPaymentAmount } from '@/lib/sh/order-search'
```

`app/api/sh/shipping/batches/[batchId]/orders/route.ts`의 `all.filter`에서 주문번호·상품명 검사 다음에 추가한다.

```ts
if (matchesPaymentAmount(order.paymentAmount, q)) return true
```

`app/api/sh/shipping/orders/route.ts`의 후보 loop에서 금액 결과를 별도 계산하고 기존 continue 조건에 포함한다.

```ts
const paymentAmountMatch = matchesPaymentAmount(o.paymentAmount, q)
if (!orderNumberMatch && !paymentAmountMatch && !piiMatch) continue
```

검색 대상 설명 comment를 실제 범위에 맞게 갱신한다. PII masking·복호화와 전화번호 최소 4자리 규칙은 변경하지 않는다.

- [ ] **Step 6: 두 검색 placeholder 갱신**

```tsx
// src/components/sh/shipping/order-search-bar.tsx
placeholder="받는분·주문번호·전화·주소·결제금액 검색"

// src/components/sh/shipping/order-detail-table.tsx
placeholder="주문번호·받는분·전화·주소·상품·결제금액 검색"
```

- [ ] **Step 7: helper test와 typecheck 통과 확인**

Run: `npm test -- src/lib/sh/__tests__/order-search.test.ts --runInBand && npm run typecheck`

Expected: test PASS, TypeScript error 0.

- [ ] **Step 8: Task 2 commit**

```bash
git add src/lib/sh/order-search.ts src/lib/sh/__tests__/order-search.test.ts app/api/sh/shipping/orders/route.ts 'app/api/sh/shipping/batches/[batchId]/orders/route.ts' src/components/sh/shipping/order-search-bar.tsx src/components/sh/shipping/order-detail-table.tsx
git commit -m "✨ feat(sh): 주문 검색에 결제금액 포함"
```

## Task 3: 배송 묶음 component를 server 기간 결과와 동기화

**Files:**
- Modify: `src/components/sh/shipping/batch-list.tsx`
- Create: `src/components/sh/shipping/__tests__/batch-list.test.tsx`

- [ ] **Step 1: component 실패 test 작성**

```tsx
// src/components/sh/shipping/__tests__/batch-list.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BatchList } from '../batch-list'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const response = {
  data: [
    {
      id: 'batch-new',
      label: '2026-09-21 오후',
      orderCount: 22,
      status: 'COMPLETED',
      source: 'MANUAL',
      createdAt: '2026-09-20T01:00:00.000Z',
      completedAt: '2026-09-21T03:00:00.000Z',
    },
  ],
  total: 1,
}

describe('BatchList', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-24T03:00:00.000Z').getTime())
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response } as Response)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('완료일 기간을 server에 보내고 결과 밖의 선택을 해제한다', async () => {
    const onSelect = jest.fn()
    render(<BatchList selectedBatchId="batch-old" onSelect={onSelect} />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const url = String((global.fetch as jest.Mock).mock.calls[0][0])
    expect(url).toContain('status=COMPLETED')
    expect(url).toContain('from=2026-09-17')
    expect(url).toContain('to=2026-09-24')
    expect(url).not.toContain('page=')
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
    expect(screen.getByText(/2026.*09.*21/)).toBeInTheDocument()
    expect(screen.getByText('2026-09-21 오후')).toBeInTheDocument()
  })

  test('collapse button을 전달된 callback에 연결한다', async () => {
    const onCollapse = jest.fn()
    render(<BatchList selectedBatchId={null} onSelect={jest.fn()} onCollapse={onCollapse} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '배송 묶음 접기' }))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: component test가 현재 구현에서 실패하는지 확인**

Run: `npm test -- src/components/sh/shipping/__tests__/batch-list.test.tsx --runInBand`

Expected: URL에 `page=`가 있고 `from`/`to`가 없으며 `onCollapse` prop이 없어 FAIL.

- [ ] **Step 3: client-side filtering과 묶음 pagination 제거**

`BatchListProps`와 fetch를 다음 책임으로 바꾼다.

```ts
import { getDaysAgoStrKst, getTodayStrKst } from '@/lib/date-range'

interface BatchListProps {
  onSelect: (batchId: string | null) => void
  selectedBatchId?: string | null
  onCollapse?: () => void
}

function getDefaultDates() {
  return { from: getDaysAgoStrKst(7), to: getTodayStrKst() }
}

const fetchBatches = useCallback(async () => {
  setLoading(true)
  try {
    const params = new URLSearchParams({
      status: 'COMPLETED',
      from: dateFrom,
      to: dateTo,
    })
    const res = await fetch(`/api/sh/shipping/batches?${params}`)
    if (!res.ok) throw new Error('배송 묶음 목록 조회 실패')
    const json = await res.json()
    const nextBatches: Batch[] = json.data ?? []
    setBatches(nextBatches)
    setLoadedRange(`${dateFrom}:${dateTo}`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '배송 묶음 목록 조회 실패')
  } finally {
    setLoading(false)
  }
}, [dateFrom, dateTo])
```

`page`, `total`, `PAGE_SIZE`, `filteredBatches`, `totalPages`와 묶음 pagination UI를 제거한다. render는 `batches`를 직접 사용한다.

현재 선택 해제는 fetch dependency에 `selectedBatchId`를 넣어 선택할 때마다 재조회하지 않도록 별도 effect로 처리한다.

```ts
const rangeKey = `${dateFrom}:${dateTo}`
const [loadedRange, setLoadedRange] = useState<string | null>(null)

useEffect(() => {
  if (loadedRange !== rangeKey || !selectedBatchId) return
  if (!batches.some((batch) => batch.id === selectedBatchId)) onSelect(null)
}, [batches, loadedRange, onSelect, rangeKey, selectedBatchId])
```

- [ ] **Step 4: 완료일 표시와 collapse control 구현**

날짜 cell과 삭제 확인 fallback은 `completedAt`을 우선 사용한다.

```tsx
const batchDate = batch.completedAt ?? batch.createdAt
<TableCell className="text-xs">{formatDate(batchDate)}</TableCell>
```

panel title 옆에는 desktop에서만 보이는 접근 가능한 collapse button을 둔다.

```tsx
{onCollapse && (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className="ml-auto hidden h-8 w-8 2xl:inline-flex"
    onClick={onCollapse}
    aria-label="배송 묶음 접기"
  >
    <ChevronLeft className="h-4 w-4" />
  </Button>
)}
```

`ChevronLeft`를 `lucide-react` import에 추가한다. 왼쪽 280px 안에서 date input 두 개가 넘치지 않도록 각각 `min-w-0 flex-1`을 사용하고 묶음 table container는 `2xl:max-h-[calc(100vh-260px)]`로 확장한다.

- [ ] **Step 5: component test 통과 확인**

Run: `npm test -- src/components/sh/shipping/__tests__/batch-list.test.tsx --runInBand`

Expected: 2 tests PASS.

- [ ] **Step 6: Task 3 commit**

```bash
git add src/components/sh/shipping/batch-list.tsx src/components/sh/shipping/__tests__/batch-list.test.tsx
git commit -m "🐛 fix(sh): 배송 묶음 기간 결과를 한 번에 표시"
```

## Task 4: `2xl` 좌우 layout과 panel 복구 rail

**Files:**
- Modify: `app/d/seller-ops/shipping/orders/page.tsx`

- [ ] **Step 1: page layout local state와 grid 구현**

page에 `batchPanelCollapsed` state를 추가하고 검색 중이 아닐 때의 두 영역을 다음 구조로 교체한다.

```tsx
const [batchPanelCollapsed, setBatchPanelCollapsed] = useState(false)

<div
  className={cn(
    'space-y-4 2xl:grid 2xl:items-start 2xl:gap-4 2xl:space-y-0',
    batchPanelCollapsed
      ? '2xl:grid-cols-[44px_minmax(0,1fr)]'
      : '2xl:grid-cols-[280px_minmax(0,1fr)]'
  )}
>
  <div
    className={cn(
      'rounded-lg border bg-card p-3',
      batchPanelCollapsed && '2xl:hidden'
    )}
  >
    <BatchList
      onSelect={setSelectedBatchId}
      selectedBatchId={selectedBatchId}
      onCollapse={() => setBatchPanelCollapsed(true)}
    />
  </div>

  <div
    className={cn(
      'hidden rounded-lg border bg-card 2xl:min-h-[220px]',
      batchPanelCollapsed && '2xl:flex 2xl:items-start 2xl:justify-center'
    )}
  >
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="mt-2 h-8 w-8"
      onClick={() => setBatchPanelCollapsed(false)}
      aria-label="배송 묶음 펼치기"
    >
      <ChevronRight className="h-4 w-4" />
    </Button>
  </div>

  <div className="min-w-0">
    {selectedBatchId ? (
      <OrderDetailTable batchId={selectedBatchId} shippingMethods={shippingMethods} />
    ) : (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        배송 묶음을 선택하세요
      </div>
    )}
  </div>
</div>
```

`Button`, `ChevronRight`, `cn` import를 추가한다. grid wrapper가 기존 fragment를 대체하므로 `BatchList`는 한 번만 mount한다. `2xl` 미만에서는 full panel이 계속 보이고 recovery rail은 숨겨진다.

- [ ] **Step 2: format과 정적 검증 실행**

Run: `npx prettier --write app/d/seller-ops/shipping/orders/page.tsx src/components/sh/shipping/batch-list.tsx`

Expected: 2 files formatted, syntax error 없음.

Run: `npm run typecheck`

Expected: TypeScript error 0.

- [ ] **Step 3: Task 4 commit**

```bash
git add app/d/seller-ops/shipping/orders/page.tsx src/components/sh/shipping/batch-list.tsx
git commit -m "💄 feat(sh): 배송 묶음과 주문 목록 좌우 배치"
```

## Task 5: 통합 검증과 UI 확인

**Files:**
- Verify only

- [ ] **Step 1: 변경 test 전체 실행**

Run:

```bash
npm test -- \
  src/lib/__tests__/date-range.test.ts \
  app/api/sh/shipping/batches/__tests__/route.test.ts \
  src/lib/sh/__tests__/order-search.test.ts \
  src/components/sh/shipping/__tests__/batch-list.test.tsx \
  --runInBand
```

Expected: 모든 suite PASS, failed test 0.

- [ ] **Step 2: repository 검증 실행**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: 각 command exit code 0. 기존 warning이 있으면 이번 변경과의 관련성을 확인해 최종 보고에 구분한다.

- [ ] **Step 3: desktop layout 수동 확인**

Run: `npm run dev`

다음 항목을 확인한다.

1. `1920px`: 묶음 280px·주문 가변 폭 좌우 배치
2. `배송 묶음 접기`: 44px recovery rail 표시, `배송 묶음 펼치기`로 복구
3. `1440px`: 상하 배치, collapse control 숨김
4. 기간 변경: 완료일 기준 결과 전체 표시, 묶음 pagination 없음
5. 기존 선택이 새 기간에 없을 때 주문 empty state 표시
6. 두 검색창에서 `390`, `39000`, `39,000`, `39,000원` 결과 동일

- [ ] **Step 4: 최종 diff 점검**

Run: `git diff --check && git status --short && git log -5 --oneline`

Expected: whitespace error 없음, `.superpowers/` 외 예상하지 않은 파일 없음, Task별 commit 확인.
