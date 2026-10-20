import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApprovalList } from '../approval-list'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }))

const base = {
  spaceId: 'sp-1',
  deckKey: 'meta-ads',
  actionType: 'meta.campaign.update',
  payload: {},
  beforeState: null,
  source: 'MCP',
  actorType: 'agent',
  actorId: 'a',
  requesterUserId: null,
  actorLabel: '에이전트',
  spendKrw: null as number | null,
  requiredRole: 'ADMIN',
  status: 'PENDING',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  decidedBy: null,
  decidedAt: null,
  executedAt: null,
  result: null,
  error: null,
  createdAt: '2026-10-14T00:00:00Z',
  updatedAt: '2026-10-14T00:00:00Z',
}
const mk = (i: number, extra: Partial<typeof base> = {}) => ({
  ...base,
  id: `act-${i}`,
  summary: `액션 ${i}`,
  ...extra,
})

const json = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
})

function mockFetch(
  actions: unknown[],
  bulkResults: unknown[] = [],
  bulkRes: () => unknown = () => json(200, { results: bulkResults })
) {
  global.fetch = jest.fn(async (url: string) => {
    if (url === '/api/spaces/current')
      return json(200, { current: { id: 'sp-1', name: '테스트 공간' } })
    if (url === '/api/agent/actions/bulk') return bulkRes()
    return json(200, { actions, role: 'ADMIN' })
  }) as unknown as typeof fetch
}

beforeEach(() => jest.clearAllMocks())

it('두 건 선택 → 확인 → POST 본문과 결과 목록', async () => {
  mockFetch(
    [mk(1), mk(2, { actionType: 'meta.ad.pause' }), mk(3)],
    [
      { actionId: 'act-1', ok: false, status: 'forbidden', message: 'OWNER 승인 필요' },
      { actionId: 'act-2', ok: true, status: 'ok', message: '승인 후 실행 완료' },
    ]
  )
  render(<ApprovalList />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '액션 1 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '액션 2 선택' }))
  expect(screen.getByText('2건 선택됨')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/「테스트 공간」에서 2건을 승인합니다/)).toBeInTheDocument()
  expect(within(dialog).getByText('meta.ad.pause')).toBeInTheDocument()

  fireEvent.click(within(dialog).getByRole('button', { name: '2건 승인' }))
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/agent/actions/bulk',
      expect.objectContaining({ method: 'POST' })
    )
  )
  const call = (global.fetch as jest.Mock).mock.calls.find(
    (c) => c[0] === '/api/agent/actions/bulk'
  )
  expect(JSON.parse(call[1].body)).toEqual({ action: 'approve', actionIds: ['act-1', 'act-2'] })

  const results = await screen.findByRole('list', { name: '처리 결과' })
  expect(within(results).getByText('건너뜀')).toBeInTheDocument()
  expect(within(results).getByText('OWNER 승인 필요')).toBeInTheDocument()
  expect(within(results).getByText('성공')).toBeInTheDocument()
  expect(within(results).getByText('액션 2')).toBeInTheDocument()
  expect(within(results).getByText('액션 1')).toBeInTheDocument()
  // 선택 해제 — 하단 바가 사라진다.
  await waitFor(() => expect(screen.queryByText(/건 선택됨/)).not.toBeInTheDocument())
})

it('전체 선택은 최대 20건까지만 고르고 안내를 보여 준다', async () => {
  mockFetch(Array.from({ length: 25 }, (_, i) => mk(i)))
  render(<ApprovalList />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '전체 선택' }))
  expect(screen.getByText('20건 선택됨')).toBeInTheDocument()
  expect(screen.getByText(/최대 20건까지/)).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '액션 24 선택' })).toBeDisabled()
})

const bulkBody = () =>
  JSON.parse(
    (global.fetch as jest.Mock).mock.calls.find((c) => c[0] === '/api/agent/actions/bulk')[1].body
  )

it('일괄 승인은 지출 건을 제외하고 보낸다 — 지출 건만이면 승인 버튼 비활성', async () => {
  mockFetch([mk(1, { spendKrw: 30000 }), mk(2)])
  render(<ApprovalList />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '액션 1 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  let dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/액션 1 — 제외\(한 건씩 승인\)/)).toBeInTheDocument()
  expect(within(dialog).getByText(/지출 1건은 제외됩니다/)).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: '0건 승인' })).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))

  fireEvent.click(screen.getByRole('checkbox', { name: '액션 2 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: '1건 승인' }))
  await waitFor(() => expect(bulkBody()).toEqual({ action: 'approve', actionIds: ['act-2'] }))
})

it('일괄 거절은 지출 건도 포함한다', async () => {
  mockFetch([mk(1, { spendKrw: 30000 }), mk(2)])
  render(<ApprovalList />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '액션 1 선택' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '액션 2 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '거절' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).queryByText(/제외/)).not.toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: '2건 거절' }))
  await waitFor(() =>
    expect(bulkBody()).toEqual({ action: 'reject', actionIds: ['act-1', 'act-2'] })
  )
})

it('일괄 요청이 실패해도 목록을 다시 불러온다', async () => {
  mockFetch([mk(1)], [], () => ({
    status: 504,
    ok: false,
    json: async () => {
      throw new Error('html')
    },
  }))
  const listCalls = () =>
    (global.fetch as jest.Mock).mock.calls.filter((c) =>
      String(c[0]).startsWith('/api/agent/actions?')
    ).length
  render(<ApprovalList />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '액션 1 선택' }))
  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  const dialog = await screen.findByRole('dialog')
  const before = listCalls()
  fireEvent.click(within(dialog).getByRole('button', { name: '1건 승인' }))
  expect(await within(dialog).findByText('일괄 처리에 실패했습니다')).toBeInTheDocument()
  await waitFor(() => expect(listCalls()).toBeGreaterThan(before))
})
