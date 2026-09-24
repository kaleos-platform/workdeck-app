import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BatchList } from '../batch-list'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))

const batch = {
  id: 'batch-1',
  label: '완료일 라벨',
  orderCount: 2,
  status: 'COMPLETED',
  source: 'MANUAL',
  createdAt: '2026-09-19T12:00:00.000Z',
  completedAt: '2026-09-21T12:00:00.000Z',
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

describe('BatchList', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-23T15:00:00.000Z').getTime())
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('KST 기준 7일 기간을 서버에 요청하고 페이지 파라미터는 보내지 않는다', async () => {
    const fetchMock = mockBatches()
    const onSelect = jest.fn()
    render(<BatchList onSelect={onSelect} />)

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
    render(<BatchList onSelect={onSelect} selectedBatchId="missing-batch" />)

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
    render(<BatchList onSelect={onSelect} selectedBatchId="missing-batch" />)

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
    const { rerender } = render(<BatchList onSelect={onSelect} selectedBatchId={null} />)

    await screen.findByText('완료일 라벨')
    rerender(<BatchList onSelect={onSelect} selectedBatchId="batch-1" />)

    expect(onSelect).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('목록에는 생성일 대신 완료일을 표시한다', async () => {
    mockBatches()
    render(<BatchList onSelect={jest.fn()} />)

    const row = (await screen.findByText('완료일 라벨')).closest('tr')
    expect(row).toHaveTextContent(/2026.*09.*21/)
    expect(row).not.toHaveTextContent(/2026.*09.*19/)
  })

  test('접기 버튼을 누르면 onCollapse를 호출한다', async () => {
    mockBatches()
    const onCollapse = jest.fn()
    render(<BatchList onSelect={jest.fn()} onCollapse={onCollapse} />)

    await screen.findByText('완료일 라벨')
    const button = screen.getByRole('button', { name: '배송 묶음 접기' })
    expect(button).toHaveClass('hidden', '2xl:inline-flex')
    fireEvent.click(button)
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  test('기간이 바뀌면 서버에서 새 기간을 조회한다', async () => {
    const fetchMock = mockBatches()
    render(<BatchList onSelect={jest.fn()} />)

    await screen.findByText('완료일 라벨')
    fireEvent.click(screen.getByRole('button', { name: '30일' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(url.searchParams.get('from')).toBe('2026-08-25')
    expect(url.searchParams.get('to')).toBe('2026-09-24')
  })

  test('시작일과 종료일을 직접 바꾸면 각각 서버에서 다시 조회한다', async () => {
    const fetchMock = mockBatches()
    render(<BatchList onSelect={jest.fn()} />)

    await screen.findByText('완료일 라벨')
    fireEvent.change(screen.getByPlaceholderText('시작일'), { target: { value: '2026-09-20' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByPlaceholderText('종료일'), { target: { value: '2026-09-23' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    const url = new URL(String(fetchMock.mock.calls[2][0]), 'http://localhost')
    expect(url.searchParams.get('from')).toBe('2026-09-20')
    expect(url.searchParams.get('to')).toBe('2026-09-23')
  })
})
