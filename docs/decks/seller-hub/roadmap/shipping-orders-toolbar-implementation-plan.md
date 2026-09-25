# 배송 데이터 상단 통합 탐색 영역 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배송 묶음 기간 설정과 통합 검색을 하나의 반응형 상단 툴바로 합치고 완료된 배송 묶음 패널 밖에 배치한다.

**Architecture:** `ShippingOrdersPage`가 기간 프리셋·날짜 범위·검색 상태를 소유하고 상단 탐색 영역을 렌더링한다. `BatchList`는 `dateFrom`과 `dateTo`를 받아 해당 기간의 완료 묶음을 조회하며, 기존 요청 경합·선택 해제·삭제 후 재조회 로직은 그대로 유지한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Jest, Testing Library

---

## 파일 구조

- `app/d/seller-ops/shipping/orders/page.tsx`: 통합 툴바 UI와 기간·검색 상태를 소유한다.
- `app/d/seller-ops/shipping/orders/__tests__/page.test.tsx`: 툴바 위치, 기간 상태 전달, 검색 전환을 검증한다.
- `src/components/sh/shipping/batch-list.tsx`: 기간 UI를 제거하고 전달받은 기간으로 목록을 조회한다.
- `src/components/sh/shipping/__tests__/batch-list.test.tsx`: 외부 기간 변경에 따른 조회와 기존 목록 동작을 검증한다.
- `src/components/sh/shipping/order-search-bar.tsx`: 통합 툴바 안에서 부모 폭을 사용할 수 있도록 루트 폭만 조정한다.

### Task 1: 페이지 상단 통합 툴바의 실패 테스트 작성

**Files:**

- Modify: `app/d/seller-ops/shipping/orders/__tests__/page.test.tsx`

- [ ] **Step 1: 날짜를 고정하고 BatchList mock이 기간 props를 표시하게 변경**

```tsx
jest.mock('@/components/sh/shipping/batch-list', () => ({
  BatchList: ({
    onSelect,
    onCollapse,
    collapseButtonRef,
    dateFrom,
    dateTo,
  }: {
    onSelect: (batchId: string) => void
    onCollapse: () => void
    collapseButtonRef?: Ref<HTMLButtonElement>
    dateFrom: string
    dateTo: string
  }) => (
    <div>
      <span>{`묶음 기간: ${dateFrom}~${dateTo}`}</span>
      <button ref={collapseButtonRef} onClick={onCollapse}>
        배송 묶음 접기
      </button>
      <button onClick={() => onSelect('batch-1')}>배송 묶음 선택</button>
    </div>
  ),
}))

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-23T15:00:00.000Z').getTime())
  // 기존 fetch mock 유지
})

afterEach(() => {
  jest.restoreAllMocks()
  // 기존 fetch 복원 유지
})
```

- [ ] **Step 2: 툴바 위치와 초기 기간을 검증하는 테스트 추가**

```tsx
test('기간 설정과 통합 검색을 작업 영역 위의 하나의 필터 영역에 표시한다', async () => {
  await act(async () => render(<ShippingOrdersPage />))

  const filter = screen.getByRole('region', { name: '배송 데이터 필터' })
  const workspace = screen.getByRole('region', { name: '배송 데이터 작업 영역' })

  expect(within(filter).getByRole('button', { name: '7일' })).toBeInTheDocument()
  expect(within(filter).getByLabelText('배송 데이터 검색')).toBeInTheDocument()
  expect(filter.compareDocumentPosition(workspace)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  expect(screen.getByText('묶음 기간: 2026-09-17~2026-09-24')).toBeInTheDocument()
})
```

`within`을 Testing Library import에 추가하고 실제 `OrderSearchBar`를 사용하도록 해당 mock은 제거한다.

- [ ] **Step 3: 프리셋 변경과 검색 중 툴바 유지 테스트 추가**

```tsx
test('30일 프리셋을 선택하면 BatchList에 새 기간을 전달한다', async () => {
  await act(async () => render(<ShippingOrdersPage />))

  fireEvent.click(screen.getByRole('button', { name: '30일' }))

  expect(screen.getByText('묶음 기간: 2026-08-25~2026-09-24')).toBeInTheDocument()
})

test('검색 결과를 표시하는 동안에도 통합 필터 영역을 유지한다', async () => {
  jest.useFakeTimers()
  await act(async () => render(<ShippingOrdersPage />))

  fireEvent.change(screen.getByLabelText('배송 데이터 검색'), { target: { value: '28000' } })
  act(() => jest.advanceTimersByTime(300))

  expect(screen.getByText('검색 결과')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '배송 데이터 필터' })).toBeInTheDocument()
  jest.useRealTimers()
})
```

- [ ] **Step 4: 테스트를 실행해 요구사항 부재로 실패하는지 확인**

Run:

```bash
npm test -- app/d/seller-ops/shipping/orders/__tests__/page.test.tsx --runInBand
```

Expected: `배송 데이터 필터` region 또는 `7일` 버튼을 찾지 못해 FAIL.

### Task 2: 페이지에 통합 툴바 구현

**Files:**

- Modify: `app/d/seller-ops/shipping/orders/page.tsx`
- Modify: `src/components/sh/shipping/order-search-bar.tsx`

- [ ] **Step 1: 기간 계산 의존성과 상수를 페이지로 이동**

`page.tsx`에 `Input`, `getDaysAgoStrKst`, `getTodayStrKst`를 import하고 다음 코드를 컴포넌트 밖에 추가한다.

```tsx
const presets = [
  { key: '7d', label: '7일' },
  { key: '30d', label: '30일' },
  { key: 'thisMonth', label: '이번달' },
  { key: 'lastMonth', label: '지난달' },
] as const

type PeriodPreset = (typeof presets)[number]['key']

function toDateStr(date: Date) {
  return date.toISOString().split('T')[0]
}
```

- [ ] **Step 2: 페이지에 기간 상태와 프리셋 변경 함수를 추가**

```tsx
const [dateFrom, setDateFrom] = useState(() => getDaysAgoStrKst(7))
const [dateTo, setDateTo] = useState(getTodayStrKst)
const [activePreset, setActivePreset] = useState<PeriodPreset | null>('7d')

function applyPreset(preset: PeriodPreset) {
  const today = getTodayStrKst()
  const [year, month] = today.split('-').map(Number)
  let from = today
  let to = today

  if (preset === '7d') from = getDaysAgoStrKst(7)
  if (preset === '30d') from = getDaysAgoStrKst(30)
  if (preset === 'thisMonth') from = toDateStr(new Date(Date.UTC(year, month - 1, 1)))
  if (preset === 'lastMonth') {
    from = toDateStr(new Date(Date.UTC(year, month - 2, 1)))
    to = toDateStr(new Date(Date.UTC(year, month - 1, 0)))
  }

  setDateFrom(from)
  setDateTo(to)
  setActivePreset(preset)
}
```

- [ ] **Step 3: 기존 단독 검색창을 한 줄 통합 툴바로 교체**

페이지 제목 바로 아래, 검색 결과/작업 영역 조건문보다 위에 다음 영역을 렌더링한다.

```tsx
<section
  aria-label="배송 데이터 필터"
  className="flex flex-col gap-2 rounded-lg border bg-card p-3 xl:flex-row xl:items-center"
>
  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
    {presets.map((preset) => (
      <Button
        key={preset.key}
        variant={activePreset === preset.key ? 'default' : 'outline'}
        size="sm"
        className="h-9 px-2 text-xs"
        onClick={() => applyPreset(preset.key)}
      >
        {preset.label}
      </Button>
    ))}
    <Input
      type="date"
      value={dateFrom}
      onChange={(event) => {
        setDateFrom(event.target.value)
        setActivePreset(null)
      }}
      className="h-9 w-[140px] text-xs"
      aria-label="배송 묶음 시작일"
    />
    <span className="text-xs text-muted-foreground">–</span>
    <Input
      type="date"
      value={dateTo}
      onChange={(event) => {
        setDateTo(event.target.value)
        setActivePreset(null)
      }}
      className="h-9 w-[140px] text-xs"
      aria-label="배송 묶음 종료일"
    />
  </div>
  <div className="w-full min-w-0 xl:ml-auto xl:max-w-md">
    <OrderSearchBar value={searchQuery} onChange={setSearchQuery} />
  </div>
</section>
```

- [ ] **Step 4: 기간을 BatchList에 전달하고 검색창 폭을 부모에 맞춤**

```tsx
<BatchList
  dateFrom={dateFrom}
  dateTo={dateTo}
  onSelect={setSelectedBatchId}
  selectedBatchId={selectedBatchId}
  onCollapse={toggleBatchPanel}
  collapseButtonRef={collapseButtonRef}
/>
```

`order-search-bar.tsx` 루트 class를 다음처럼 변경한다.

```tsx
<div className="relative w-full">
```

- [ ] **Step 5: 페이지 단위 툴바 테스트 통과 확인**

Run:

```bash
npm test -- app/d/seller-ops/shipping/orders/__tests__/page.test.tsx --runInBand
```

Expected: 페이지 suite PASS. 이 테스트에서는 `BatchList`를 mock하므로 실제 컴포넌트의 props 변경은 다음 작업에서 검증한다.

### Task 3: BatchList를 외부 기간 입력 방식으로 변경

**Files:**

- Modify: `src/components/sh/shipping/__tests__/batch-list.test.tsx`
- Modify: `src/components/sh/shipping/batch-list.tsx`

- [ ] **Step 1: 테스트 렌더 헬퍼에 기본 기간을 제공**

테스트 파일에 다음 헬퍼를 추가하고 모든 `render(<BatchList ... />)` 호출을 `renderBatchList(...)`로 교체한다.

```tsx
const defaultPeriod = {
  dateFrom: '2026-09-17',
  dateTo: '2026-09-24',
}

function renderBatchList(props: Partial<ComponentProps<typeof BatchList>> = {}) {
  return render(<BatchList {...defaultPeriod} onSelect={jest.fn()} {...props} />)
}
```

React import에 `ComponentProps` 타입을 추가한다.

- [ ] **Step 2: 내부 기간 컨트롤 테스트를 외부 기간 변경 테스트로 교체**

기존 `기간이 바뀌면 서버에서 새 기간을 조회한다`와 `시작일과 종료일을 직접 바꾸면...` 테스트를 제거하고 다음 테스트를 추가한다.

```tsx
test('전달받은 기간이 바뀌면 서버에서 새 기간을 조회한다', async () => {
  const fetchMock = mockBatches()
  const { rerender } = renderBatchList()

  await screen.findByText('완료일 라벨')
  rerender(<BatchList dateFrom="2026-08-25" dateTo="2026-09-24" onSelect={jest.fn()} />)

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
  expect(url.searchParams.get('from')).toBe('2026-08-25')
  expect(url.searchParams.get('to')).toBe('2026-09-24')
})

test('배송 묶음 패널에는 기간 컨트롤을 렌더링하지 않는다', async () => {
  mockBatches()
  renderBatchList()

  await screen.findByText('완료일 라벨')
  expect(screen.queryByRole('button', { name: '7일' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('배송 묶음 시작일')).not.toBeInTheDocument()
})
```

삭제 대기 중 기간 변경 테스트는 input event 대신 `rerender`로 `dateFrom="2026-08-25"`를 전달하도록 바꾼다.

- [ ] **Step 3: BatchList 테스트가 새 props 부재로 실패하는지 확인**

Run:

```bash
npm test -- src/components/sh/shipping/__tests__/batch-list.test.tsx --runInBand
```

Expected: 기간 props 타입 오류 또는 기존 내부 기간 컨트롤 기대 불일치로 FAIL.

- [ ] **Step 4: BatchList props에 기간을 추가하고 내부 기간 상태·UI를 제거**

```tsx
interface BatchListProps {
  dateFrom: string
  dateTo: string
  onSelect: (batchId: string | null) => void
  selectedBatchId?: string | null
  onCollapse?: () => void
  collapseButtonRef?: Ref<HTMLButtonElement>
}

export function BatchList({
  dateFrom,
  dateTo,
  onSelect,
  selectedBatchId,
  onCollapse,
  collapseButtonRef,
}: BatchListProps) {
```

다음을 삭제한다.

- `getDaysAgoStrKst`, `getTodayStrKst`, `Input` import
- `toDateStr`
- 내부 `dateFrom`, `dateTo`, `activePreset` state
- `applyPreset`과 `presets`
- 프리셋 버튼과 날짜 input JSX

제목과 접기 버튼은 유지한다.

```tsx
<div className="flex items-center justify-between gap-2">
  <h2 className="shrink-0 text-sm font-semibold">완료된 배송 묶음</h2>
  {onCollapse && (
    // 기존 접기 버튼 그대로 유지
  )}
</div>
```

- [ ] **Step 5: BatchList와 페이지 테스트를 실행해 통과 확인**

Run:

```bash
npm test -- src/components/sh/shipping/__tests__/batch-list.test.tsx app/d/seller-ops/shipping/orders/__tests__/page.test.tsx --runInBand
```

Expected: 두 suite 모두 PASS.

- [ ] **Step 6: 구현 커밋**

```bash
git add app/d/seller-ops/shipping/orders/page.tsx \
  app/d/seller-ops/shipping/orders/__tests__/page.test.tsx \
  src/components/sh/shipping/batch-list.tsx \
  src/components/sh/shipping/__tests__/batch-list.test.tsx \
  src/components/sh/shipping/order-search-bar.tsx
git commit -m "💄 feat(sh): 배송 데이터 탐색 필터 상단 통합"
```

### Task 4: 전체 검증과 반응형 확인

**Files:**

- Verify only

- [ ] **Step 1: 배송 화면 관련 테스트 실행**

Run:

```bash
npm test -- src/components/sh/shipping/__tests__/batch-list.test.tsx app/d/seller-ops/shipping/orders/__tests__/page.test.tsx --runInBand
```

Expected: 모든 테스트 PASS.

- [ ] **Step 2: 전체 정적 검사와 테스트 실행**

Run:

```bash
npm test -- --runInBand
npm run typecheck
npm run lint
```

Expected: 테스트와 typecheck PASS, lint 오류 0. 기존 warning은 별도 기록.

- [ ] **Step 3: production build 실행**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key \
npm run build
```

Expected: build PASS, `/d/seller-ops/shipping/orders` route 생성 확인.

- [ ] **Step 4: desktop과 좁은 화면을 직접 확인**

`npm run dev`로 화면을 열어 다음을 확인한다.

- desktop: 기간과 검색이 한 줄이고 좌우 작업 영역 위에 있음
- 좁은 화면: 기간과 검색이 겹치지 않고 검색이 전체 폭을 사용함
- 검색 중: 통합 툴바가 유지됨
- 완료 묶음 패널: 기간 컨트롤 없이 제목·접기·목록만 표시됨

인증 데이터 접근이 불가능하면 자동화 테스트와 production build 결과를 기록하고 해당 수동 검증 제한을 최종 보고한다.

- [ ] **Step 5: 최종 상태 확인**

Run:

```bash
git status --short
git diff --check origin/main...HEAD
```

Expected: 의도한 파일 외 변경 없음, whitespace 오류 없음.
