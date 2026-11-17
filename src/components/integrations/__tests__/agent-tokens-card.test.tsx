import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AgentTokensCard } from '../agent-tokens-card'

// fetchWithMfa 는 실제 구현을 쓰고, 단계 인증 다이얼로그·세션만 대체한다.
jest.mock('@/lib/auth/mfa-client', () => ({
  ...jest.requireActual('@/lib/auth/mfa-client'),
  redirectIfMfaRequired: jest.fn(async () => false),
}))
jest.mock('@/components/auth/mfa-step-up-dialog', () => ({
  requestMfaStepUp: jest.fn(async () => 'verified'),
}))
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: jest.fn(async () => ({})) } }),
}))

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

// 회귀: 현재 Space(쿠키)가 다른 탭에서 바뀌어도 제목은 발급 대상(members 응답 spaceId)의 이름.
it('토큰 발급 대화상자 제목에 발급 대상 Space 이름이 보인다', async () => {
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/spaces/current'
      ? res({ current: { id: 'sp-2', name: 'Space B' } })
      : url.startsWith('/api/spaces/members')
        ? res({ spaceId: 'sp-1', spaceName: 'Space A' })
        : base(url, init)
  )
  render(<AgentTokensCard />)
  await screen.findByText('테스트 에이전트')
  fireEvent.click(screen.getByRole('button', { name: '토큰 발급' }))
  expect(await screen.findByText('「Space A」 토큰 발급')).toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: '발급' }))
  await waitFor(() =>
    expect(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')?.[0]).toBe(
      '/api/spaces/sp-1/agents/ag1/tokens'
    )
  )
})

it('Space 이름을 못 받으면 대화상자 제목은 기존 문구다', async () => {
  render(<AgentTokensCard />)
  await screen.findByText('테스트 에이전트')
  fireEvent.click(screen.getByRole('button', { name: '토큰 발급' }))
  expect(await screen.findByRole('heading', { name: '토큰 발급' })).toBeInTheDocument()
})

it('권한 저장이 MFA_REQUIRED 여도 인증 후 같은 PATCH 를 다시 보내 저장하고 닫는다', async () => {
  const base = fetchMock.getMockImplementation()!
  let patches = 0
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === '/api/spaces/sp-1/agents/ag1' && init?.method === 'PATCH') {
      patches += 1
      return patches === 1 ? res({ code: 'MFA_REQUIRED' }, 403) : res({ ok: true })
    }
    return base(url, init)
  })
  render(<AgentTokensCard />)
  await screen.findByText('테스트 에이전트')
  fireEvent.click(screen.getByRole('button', { name: '권한 수정' }))
  fireEvent.click(await screen.findByRole('button', { name: '저장' }))
  await waitFor(() => expect(patches).toBe(2))
  const bodies = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH').map((c) => c[1].body)
  expect(bodies[0]).toBe(bodies[1])
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument()
  )
  const listCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/spaces/sp-1/agents')
  expect(listCalls.length).toBeGreaterThanOrEqual(2)
})
