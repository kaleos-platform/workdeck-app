import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef, type ComponentProps } from 'react'
import { BatchList } from '../batch-list'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const batch = {
  id: 'batch-1',
  label: '완료일 라벨',
  orderCount: 2,
  status: 'COMPLETED',
  source: 'MANUAL',
  createdAt: '2026-09-19T12:00:00.000Z',
  completedAt: '2026-09-21T14:00:00.000Z',
}

const longImportBatch = {
  ...batch,
  id: 'long-import',
  label: '아주 긴 이전 배송 묶음 라벨 '.repeat(20).trim(),
  source: 'IMPORT',
}

function mockBatches(data: (typeof batch)[] = [batch]) {
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL]>(
    async () =>
      ({
        ok: true,
        json: async () => ({ data }),
      }) as Partial<Response> as Response
  )
  global.fetch = fetchMock as typeof fetch
  return fetchMock
}

const defaultPeriod = { dateFrom: '2026-09-17', dateTo: '2026-09-24' }

function renderBatchList(props: Partial<ComponentProps<typeof BatchList>> = {}) {
  return render(<BatchList {...defaultPeriod} onSelect={jest.fn()} {...props} />)
}

describe('BatchList', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('전달받은 기간을 서버에 요청하고 페이지 파라미터는 보내지 않는다', async () => {
    const fetchMock = mockBatches()
    const onSelect = jest.fn()
    renderBatchList({ onSelect })

    await screen.findByText('완료일 라벨')
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/sh/shipping/batches')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'COMPLETED',
      from: '2026-09-17',
      to: '2026-09-24',
    })
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('조회가 완료된 기간에 선택 묶음이 없으면 선택을 해제한다', async () => {
    mockBatches()
    const onSelect = jest.fn()
    renderBatchList({ onSelect, selectedBatchId: 'missing-batch' })

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  test('첫 조회가 끝나기 전에는 선택을 해제하지 않는다', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        })
    )
    global.fetch = fetchMock as typeof fetch
    const onSelect = jest.fn()
    renderBatchList({ onSelect, selectedBatchId: 'missing-batch' })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(onSelect).not.toHaveBeenCalled()
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ data: [] }) } as Partial<Response> as Response)
    })
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  test('조회 결과에 선택 묶음이 있으면 유지하고 선택 변경 시 재조회하지 않는다', async () => {
    const fetchMock = mockBatches()
    const onSelect = jest.fn()
    const { rerender } = renderBatchList({ onSelect, selectedBatchId: null })

    await screen.findByText('완료일 라벨')
    rerender(<BatchList {...defaultPeriod} onSelect={onSelect} selectedBatchId="batch-1" />)

    expect(onSelect).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('목록에는 생성일 대신 완료일을 표시한다', async () => {
    mockBatches()
    renderBatchList()

    const row = (await screen.findByText('완료일 라벨')).closest('tr')
    expect(row).toHaveTextContent(/2026.*09.*21/)
    expect(row).not.toHaveTextContent(/2026.*09.*19/)
  })

  test.each([
    ['일반 라벨', batch],
    ['긴 IMPORT 라벨', longImportBatch],
  ])('%s에서도 3열 식별 셀과 수량·삭제 열을 보존한다', async (_name, item) => {
    mockBatches([item])
    renderBatchList()

    const label = await screen.findByText(item.label)
    const table = screen.getByRole('table')
    const row = label.closest('tr') as HTMLTableRowElement
    const cells = within(row).getAllByRole('cell')
    expect(table).toHaveClass('table-fixed')
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3)
    expect(cells).toHaveLength(3)
    expect(cells[0]).toHaveClass('min-w-0')
    expect(label).toHaveClass('truncate')
    expect(label).toHaveAttribute('title', item.label)
    expect(cells[1]).toHaveTextContent('2')
    expect(within(cells[2]).getByRole('button', { name: '배송 묶음 삭제' })).toBeInTheDocument()
    if (item.source === 'IMPORT') {
      expect(within(cells[0]).getByText('이전')).toHaveClass('shrink-0')
    }
  })

  test('접기 버튼을 누르면 onCollapse를 호출한다', async () => {
    mockBatches()
    const onCollapse = jest.fn()
    renderBatchList({ onCollapse })

    await screen.findByText('완료일 라벨')
    const button = screen.getByRole('button', { name: '배송 묶음 접기' })
    expect(button).toHaveClass('hidden', '2xl:inline-flex')
    fireEvent.click(button)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  test('접기 버튼 ref를 실제 버튼에 연결한다', async () => {
    mockBatches()
    const collapseButtonRef = createRef<HTMLButtonElement>()
    renderBatchList({ onCollapse: jest.fn(), collapseButtonRef })

    await screen.findByText('완료일 라벨')
    expect(collapseButtonRef.current).toBe(screen.getByRole('button', { name: '배송 묶음 접기' }))
  })

  test('전달받은 기간이 바뀌면 서버에서 새 기간을 조회한다', async () => {
    const fetchMock = mockBatches()
    const onSelect = jest.fn()
    const { rerender } = renderBatchList({ onSelect })

    await screen.findByText('완료일 라벨')
    rerender(<BatchList {...defaultPeriod} dateFrom="2026-08-25" onSelect={onSelect} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(url.searchParams.get('from')).toBe('2026-08-25')
    expect(url.searchParams.get('to')).toBe('2026-09-24')

    rerender(<BatchList dateFrom="2026-08-25" dateTo="2026-09-23" onSelect={onSelect} />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const nextUrl = new URL(String(fetchMock.mock.calls[2][0]), 'http://localhost')
    expect(nextUrl.searchParams.get('from')).toBe('2026-08-25')
    expect(nextUrl.searchParams.get('to')).toBe('2026-09-23')
  })

  test('배송 묶음 패널에는 기간 컨트롤을 렌더링하지 않는다', async () => {
    mockBatches()
    const { container } = renderBatchList()

    await screen.findByText('완료일 라벨')
    expect(screen.queryByRole('button', { name: '7일' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('배송 묶음 시작일')).not.toBeInTheDocument()
    expect(container.querySelector('input[type="date"]')).toBeNull()
  })

  test('새 기간 조회가 실패하면 이전 행을 숨기고 선택을 해제한다', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL]>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [batch] }),
      } as Partial<Response> as Response)
      .mockResolvedValueOnce({ ok: false } as Response)
    global.fetch = fetchMock as typeof fetch
    const onSelect = jest.fn()
    const { rerender } = renderBatchList({ onSelect, selectedBatchId: 'batch-1' })

    await screen.findByText('완료일 라벨')
    rerender(
      <BatchList
        {...defaultPeriod}
        dateFrom="2026-08-25"
        onSelect={onSelect}
        selectedBatchId="batch-1"
      />
    )

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null))
    expect(screen.queryByText('완료일 라벨')).not.toBeInTheDocument()
  })

  test('삭제 대기 중 기간을 바꾸면 삭제 후 현재 기간을 다시 조회한다', async () => {
    let resolveDelete!: (response: Response) => void
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Promise<Response>((resolve) => {
          resolveDelete = resolve
        })
      }
      const from = new URL(String(input), 'http://localhost').searchParams.get('from')
      return {
        ok: true,
        json: async () => ({ data: from === '2026-09-17' ? [batch] : [] }),
      } as Partial<Response> as Response
    })
    global.fetch = fetchMock as typeof fetch
    const onSelect = jest.fn()
    const { rerender } = renderBatchList({ onSelect })

    await screen.findByText('완료일 라벨')
    fireEvent.click(screen.getByRole('button', { name: '배송 묶음 삭제' }))
    fireEvent.change(screen.getByPlaceholderText('완료일 라벨'), {
      target: { value: '완료일 라벨' },
    })
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
    )

    rerender(<BatchList {...defaultPeriod} dateFrom="2026-08-25" onSelect={onSelect} />)
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init).length).toBe(2))

    await act(async () => {
      resolveDelete({ ok: true, json: async () => ({}) } as Partial<Response> as Response)
    })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => !init).length).toBe(3))
    const getUrls = fetchMock.mock.calls
      .filter(([, init]) => !init)
      .map(([input]) => new URL(String(input), 'http://localhost'))
    expect(getUrls[2].searchParams.get('from')).toBe('2026-08-25')
    expect(screen.queryByText('완료일 라벨')).not.toBeInTheDocument()
  })
})
