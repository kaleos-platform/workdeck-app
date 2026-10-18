import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentTokensCard } from '../agent-tokens-card'

jest.mock('@/lib/auth/mfa-client', () => ({ redirectIfMfaRequired: jest.fn(async () => false) }))

const res = (body: unknown, status = 200) => {
  const r = { ok: status < 400, status, json: async () => body, clone: () => r }
  return Promise.resolve(r)
}
const agent = {
  id: 'ag1',
  name: '테스트 에이전트',
  kind: 'agent',
  scopes: ['ads:read'],
  status: 'ACTIVE',
  tokens: [
    {
      id: 't0',
      createdAt: '2026-10-01T00:00:00Z',
      lastUsedAt: null,
      expiresAt: '2099-01-01T00:00:00Z',
      revokedAt: null,
    },
  ],
}
let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/spaces/members')) return res({ spaceId: 'sp-1' })
    if (url === '/api/spaces/sp-1/agents/ag1/tokens' && init?.method === 'POST')
      return res({ tokenId: 't1', token: 'wdk_agt_t1.TESTTOKEN', expiresAt: '2027-01-01' }, 201)
    if (url === '/api/spaces/sp-1/agents') return res({ agents: [agent] })
    return res({}, 404)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

it('에이전트를 나열하고 발급한 토큰은 대화상자에서 한 번만 보여 준다', async () => {
  render(<AgentTokensCard />)
  expect(await screen.findByText('테스트 에이전트')).toBeInTheDocument()
  expect(screen.getByText('ads:read')).toBeInTheDocument()
  expect(screen.getByText('활성', { selector: 'td' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '토큰 발급' }))
  fireEvent.click(await screen.findByRole('button', { name: '발급' }))
  const input = await screen.findByLabelText('발급된 토큰')
  expect(input).toHaveValue('wdk_agt_t1.TESTTOKEN')
  expect(screen.getByText('이 창을 닫으면 다시 볼 수 없습니다.')).toBeInTheDocument()
  expect(JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')[1].body)).toEqual({
    expiresInDays: 90,
  })

  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  await waitFor(() => expect(screen.queryByLabelText('발급된 토큰')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '토큰 발급' }))
  await screen.findByRole('button', { name: '발급' })
  expect(screen.queryByDisplayValue('wdk_agt_t1.TESTTOKEN')).not.toBeInTheDocument()
})
