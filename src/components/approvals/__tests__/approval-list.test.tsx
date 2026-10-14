import { fireEvent, render, screen } from '@testing-library/react'
import { ApprovalList } from '../approval-list'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('spaceId=sp-1'),
}))
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

beforeEach(() => {
  const r = { status: 200, ok: true, json: async () => ({ actions: [action], role: 'OWNER' }) }
  global.fetch = jest.fn().mockResolvedValue({ ...r, clone: () => r }) as unknown as typeof fetch
})

it('상세 시트에 실제 파라미터를 텍스트로 보여준다(HTML로 해석하지 않음)', async () => {
  render(<ApprovalList />)
  fireEvent.click(await screen.findByText('캠페인 예산 변경'))

  expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('50,000원')).toBeInTheDocument()
  expect(screen.getByText('OWNER')).toBeInTheDocument()
})
