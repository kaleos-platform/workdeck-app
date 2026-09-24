# Shipping Order Search Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배송 주문 검색 결과의 연관 정보를 2줄 셀로 묶어 7개 컬럼으로 줄이고, 일반 desktop 작업 영역에서 결제금액까지 보이게 한다.

**Architecture:** 기존 `OrderSearchResults`의 fetch, 상태, 상세 dialog는 유지하고 table header와 row markup만 변경한다. 받는분·전화번호와 주문번호·주문일을 각각 하나의 셀로 합치고 표 최소 폭을 `1080px`로 낮추며, 기존 `overflow-x-auto`를 좁은 화면의 fallback으로 유지한다.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Jest 30, Testing Library

---

## 파일 구조

- Create: `src/components/sh/shipping/__tests__/order-search-results.test.tsx` — 검색 결과의 7열 구조, 묶음 셀, 폭 및 금액 정렬 회귀를 검증한다.
- Modify: `src/components/sh/shipping/order-search-results.tsx` — 검색 결과 table header와 row를 7열·2줄 구조로 변경한다.

### Task 1: 검색 결과를 7개 그룹 컬럼으로 변경

**Files:**

- Create: `src/components/sh/shipping/__tests__/order-search-results.test.tsx`
- Modify: `src/components/sh/shipping/order-search-results.tsx:165-252`

- [ ] **Step 1: 7열 구조를 요구하는 실패 테스트 작성**

`src/components/sh/shipping/__tests__/order-search-results.test.tsx`를 다음 내용으로 생성한다.

```tsx
import { render, screen, within } from '@testing-library/react'
import { OrderSearchResults } from '../order-search-results'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}))

jest.mock('../order-edit-dialog', () => ({
  OrderEditDialog: () => null,
}))

const order = {
  id: 'order-1',
  recipientName: '홍길동',
  phone: '010-1234-5678',
  address: '서울특별시 중구 세종대로 110',
  orderNumber: 'ORDER-20260923-1',
  orderDate: '2026-09-23T03:00:00.000Z',
  paymentAmount: '28000',
  postalCode: '04524',
  deliveryMessage: null,
  memo: '문 앞에 놓아주세요',
  channel: { id: 'channel-1', name: '쿠팡' },
  shippingMethod: { id: 'method-1', name: '택배' },
  items: [{ name: '테스트 상품', quantity: 2 }],
}

function mockSearchResult() {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      data: [order],
      total: 1,
      hasMore: false,
    }),
  })) as typeof fetch
}

describe('OrderSearchResults', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('연관 정보를 2줄 셀로 묶고 결제금액까지 7개 컬럼으로 표시한다', async () => {
    mockSearchResult()
    render(<OrderSearchResults query="28000" shippingMethods={[]} channels={[]} />)

    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers).toHaveLength(7)
    expect(headers.map((header) => header.textContent)).toEqual([
      '받는분 · 전화번호',
      '주문번호 · 주문일',
      '주소',
      '상품명',
      '배송메모',
      '판매채널',
      '결제금액',
    ])
    expect(table).toHaveClass('min-w-[1080px]')
    expect(table).not.toHaveClass('min-w-[1350px]')

    const row = screen.getByText('홍길동').closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLTableRowElement).getAllByRole('cell')
    expect(cells).toHaveLength(7)
    expect(cells[0]).toHaveTextContent('홍길동')
    expect(cells[0]).toHaveTextContent('010-1234-5678')
    expect(cells[1]).toHaveTextContent('ORDER-20260923-1')
    expect(cells[1]).toHaveTextContent(/2026.*09.*23/)
    expect(cells[2]).toHaveAttribute('title', order.address)
    expect(cells[3]).toHaveAttribute('title', '테스트 상품 ×2')
    expect(cells[6]).toHaveTextContent('28,000원')
    expect(cells[6]).toHaveClass('text-right', 'whitespace-nowrap', 'tabular-nums')
  })
})
```

- [ ] **Step 2: 테스트가 기존 9열 구조에서 실패하는지 확인**

Run:

```bash
npm test -- src/components/sh/shipping/__tests__/order-search-results.test.tsx --runInBand
```

Expected: FAIL. 실제 column header가 9개이고 table에 `min-w-[1080px]`가 없어야 한다.

- [ ] **Step 3: table header와 row를 최소 변경으로 7열화**

`src/components/sh/shipping/order-search-results.tsx`에서 table 부분을 다음 구조로 변경한다. fetch, loading/error/empty state, 상세 dialog 코드는 수정하지 않는다.

```tsx
<div className="overflow-x-auto rounded-lg border">
  <table className="w-full min-w-[1080px] table-fixed text-sm">
    <thead className="border-b bg-muted/40">
      <tr className="text-left text-xs text-muted-foreground">
        <th className="w-[145px] px-3 py-2 font-medium">받는분 · 전화번호</th>
        <th className="w-[160px] px-3 py-2 font-medium">주문번호 · 주문일</th>
        <th className="w-[245px] px-3 py-2 font-medium">주소</th>
        <th className="w-[185px] px-3 py-2 font-medium">상품명</th>
        <th className="w-[120px] px-3 py-2 font-medium">배송메모</th>
        <th className="w-[125px] px-3 py-2 font-medium">판매채널</th>
        <th className="w-[100px] px-3 py-2 text-right font-medium">결제금액</th>
      </tr>
    </thead>
    <tbody>
      {orders.map((o) => {
        const dec = decryptedRows[o.id]
        const isDecrypting = decryptingId === o.id
        return (
          <tr
            key={o.id}
            className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
            onClick={() => setDetailOrder(o)}
          >
            <td className="px-3 py-2">
              <div className="flex min-w-0 items-start gap-1">
                <span className="truncate" title={dec?.recipientName ?? o.recipientName}>
                  {dec?.recipientName ?? o.recipientName}
                </span>
                <button
                  type="button"
                  className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDecryptInline(o.id)
                  }}
                  disabled={isDecrypting}
                  title={dec ? '개인정보 숨기기' : '개인정보 보기'}
                >
                  {dec ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="truncate text-xs text-muted-foreground" title={dec?.phone ?? o.phone}>
                {dec?.phone ?? o.phone}
              </div>
            </td>
            <td className="px-3 py-2">
              <div className="truncate" title={o.orderNumber ?? ''}>
                {o.orderNumber ?? '-'}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {formatDate(o.orderDate)}
              </div>
            </td>
            <td className="truncate px-3 py-2" title={dec?.address ?? o.address}>
              {dec?.address ?? o.address}
            </td>
            <td className="truncate px-3 py-2" title={summarizeItems(o.items)}>
              {summarizeItems(o.items)}
            </td>
            <td className="truncate px-3 py-2" title={o.memo ?? ''}>
              {o.memo || '-'}
            </td>
            <td className="truncate px-3 py-2" title={o.channel?.name ?? ''}>
              {o.channel?.name ?? '-'}
            </td>
            <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
              {formatAmount(o.paymentAmount)}
            </td>
          </tr>
        )
      })}
    </tbody>
  </table>
</div>
```

- [ ] **Step 4: 새 component 테스트와 인접 shipping 테스트 실행**

Run:

```bash
npm test -- src/components/sh/shipping/__tests__/order-search-results.test.tsx src/components/sh/shipping/__tests__/batch-list.test.tsx --runInBand
```

Expected: PASS, 2 suites. 새 테스트는 7열·묶음 셀·`1080px` 폭·금액 정렬을 확인하고 기존 배송 묶음 테스트도 모두 통과해야 한다.

- [ ] **Step 5: 구현 커밋**

```bash
git add src/components/sh/shipping/order-search-results.tsx \
  src/components/sh/shipping/__tests__/order-search-results.test.tsx
git commit -m "🐛 fix: 주문 검색 결과 컬럼 잘림 개선"
```

### Task 2: 전체 품질 게이트와 변경 범위 검증

**Files:**

- Verify: `src/components/sh/shipping/order-search-results.tsx`
- Verify: `src/components/sh/shipping/__tests__/order-search-results.test.tsx`

- [ ] **Step 1: 전체 unit test 실행**

Run:

```bash
npm test -- --runInBand
```

Expected: 모든 unit test suite가 PASS한다.

- [ ] **Step 2: typecheck와 lint 실행**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: 두 명령 모두 exit code 0이다.

- [ ] **Step 3: production build 실행**

Run:

```bash
npm run build
```

Expected: Next.js production build가 exit code 0으로 완료된다.

- [ ] **Step 4: diff와 workspace 상태 확인**

Run:

```bash
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: whitespace 오류가 없고, 변경 파일은 설계·계획 문서와 검색 결과 component·test로 제한되며, worktree에 미커밋 변경이 없다.

- [ ] **Step 5: desktop과 좁은 화면 수동 확인 항목 기록**

`/d/seller-ops/shipping/orders`에서 결제금액으로 검색해 다음을 확인한다.

- desktop 작업 영역에서 `받는분 · 전화번호`부터 `결제금액`까지 7개 header가 보인다.
- 받는분/전화번호와 주문번호/주문일이 각각 같은 셀에 2줄로 보인다.
- 주소·상품명·배송메모가 길면 한 줄 말줄임되고 hover 시 전체 값이 보인다.
- 개인정보 보기 버튼, 행 클릭 상세 dialog, 결제금액 표시가 정상 동작한다.
- 좁은 화면에서는 표 내용이 겹치지 않고 가로 스크롤할 수 있다.
