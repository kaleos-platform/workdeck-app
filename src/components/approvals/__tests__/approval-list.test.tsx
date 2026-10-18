import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { ApprovalList } from '../approval-list'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }))

const action = {
  id: 'act-1',
  spaceId: 'sp-1',
  deckKey: 'meta-ads',
  actionType: 'meta.campaign.update',
  payload: { name: '<script>alert(1)</script>', dailyBudget: 50000 },
  summary: '캠페인 예산 변경',
  beforeState: null,
  source: 'MCP',
  actorType: 'agent',
  actorId: 'a',
  requesterUserId: null,
  actorLabel: '에이전트 에밀리',
  spendKrw: 50000,
  requiredRole: 'OWNER',
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

const res = (status: number, body: unknown) => {
  const r = { status, ok: status < 300, json: async () => body }
  return { ...r, clone: () => r }
}
function mockList(role: string, overrides: Partial<typeof action> = {}) {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      res(200, { actions: [{ ...action, ...overrides }], role })
    ) as unknown as typeof fetch
}

beforeEach(() => {
  jest.clearAllMocks()
  mockList('OWNER')
})

it('상세 시트에 실제 파라미터를 텍스트로 보여준다(HTML로 해석하지 않음)', async () => {
  render(<ApprovalList />)
  fireEvent.click(await screen.findByText('캠페인 예산 변경'))

  expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('50,000원')).toBeInTheDocument()
  expect(screen.getByText('OWNER')).toBeInTheDocument()
})

it('OWNER가 필요한 액션은 ADMIN에게 승인 버튼을 막고 "OWNER 승인 필요"를 보여준다(거부는 가능)', async () => {
  mockList('ADMIN')
  render(<ApprovalList />)
  fireEvent.click(await screen.findByText('캠페인 예산 변경'))

  expect(await screen.findByText(/OWNER 승인 필요/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '승인' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '거부' })).toBeEnabled()
})

it('PATCH 403이면 서버가 준 사유를 그대로 보여준다', async () => {
  mockList('ADMIN', { requiredRole: 'ADMIN' })
  render(<ApprovalList />)
  fireEvent.click(await screen.findByText('캠페인 예산 변경'))
  const message = '지출 제안은 OWNER(회사 대표 계정)만 승인할 수 있습니다.'
  ;(global.fetch as jest.Mock).mockResolvedValueOnce(
    res(403, { outcome: { ok: false, status: 'FORBIDDEN', message } })
  )
  fireEvent.click(await screen.findByRole('button', { name: '승인' }))

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
})
