import { render, screen, waitFor } from '@testing-library/react'
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
  mockCurrent({ current: { id: 'sp-1', name: 'Space A', role: 'OWNER' } })
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

// 회귀: 승인 대상은 action.spaceId — 현재 Space 가 다르면(다른 탭에서 전환) 이름을 붙이지 않는다.
it('제안의 Space 가 현재 Space 와 다르면 이름 없이 기본 문구다', async () => {
  mockCurrent({ current: { id: 'sp-other', name: 'Space B', role: 'OWNER' } })
  renderSheet()
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
  expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Space B/ })).toBeNull()
})

it('지출이 아닌 OWNER 액션(비밀값)은 덱 이름과 일반 OWNER 안내를 보여준다', async () => {
  mockCurrent(null, false)
  render(
    <ApprovalDetailSheet
      action={
        {
          ...action,
          deckKey: 'secrets',
          actionType: 'secret.http.request',
          spendKrw: null,
          requiredRole: 'OWNER',
        } as AgentPendingActionDTO
      }
      open
      onOpenChange={() => {}}
      canDecide
      viewerRole="ADMIN"
      onDecided={() => {}}
    />
  )
  expect(await screen.findByText('비밀값')).toBeInTheDocument()
  expect(
    screen.getByText('OWNER 승인 필요 — 이 요청은 회사 대표 계정(OWNER)만 승인할 수 있습니다.')
  ).toBeInTheDocument()
  expect(screen.queryByText(/지출 한도/)).not.toBeInTheDocument()
})
