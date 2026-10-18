import { render, screen } from '@testing-library/react'
import { ApprovalDetailSheet } from '../approval-detail-sheet'
import type { AgentPendingActionDTO } from '../types'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }))

const action = {
  id: 'act-1',
  spaceId: 'sp-1',
  deckKey: 'meta-ads',
  actionType: 'meta.campaign.update',
  payload: { dailyBudget: 50000 },
  summary: '캠페인 예산 변경',
  beforeState: null,
  source: 'MCP',
  actorType: 'agent',
  actorId: 'a',
  requesterUserId: null,
  actorLabel: '에이전트 에밀리',
  spendKrw: 50000,
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
} as unknown as AgentPendingActionDTO

const renderSheet = () =>
  render(
    <ApprovalDetailSheet
      action={action}
      open
      onOpenChange={() => {}}
      canDecide
      viewerRole="OWNER"
      onDecided={() => {}}
    />
  )

function mockCurrent(body: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch
}

it('승인·거부 버튼에 현재 Space 이름이 들어간다', async () => {
  mockCurrent({ current: { id: 'sp-a', name: 'Space A', role: 'OWNER' } })
  renderSheet()
  expect(await screen.findByRole('button', { name: '「Space A」에서 승인' })).toBeEnabled()
  expect(screen.getByRole('button', { name: '「Space A」에서 거부' })).toBeInTheDocument()
})

it('이름을 못 받으면 기존 문구를 유지한다', async () => {
  mockCurrent(null, false)
  renderSheet()
  expect(await screen.findByRole('button', { name: '승인' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '거부' })).toBeInTheDocument()
})
