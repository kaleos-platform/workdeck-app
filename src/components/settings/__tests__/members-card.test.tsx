import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { MembersCard } from '../members-card'

jest.mock('@/lib/auth/mfa-client', () => ({ redirectIfMfaRequired: jest.fn() }))
const mfaRedirect = redirectIfMfaRequired as jest.Mock

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })
let fetchMock: jest.Mock
let postResponse: () => Promise<unknown>

const owner = {
  spaceId: 'sp-1',
  myRole: 'OWNER',
  members: [
    {
      id: 'm1',
      role: 'OWNER',
      slackUserId: null,
      user: { email: 'owner@example.com', name: '소유자' },
    },
  ],
}

beforeEach(() => {
  mfaRedirect.mockReset().mockResolvedValue(false)
  postResponse = () =>
    json(
      {
        invitationId: 'inv-1',
        link: 'https://app.example.com/invite/TOK',
        emailSent: true,
        expiresAt: '2026-10-22T00:00:00Z',
      },
      201
    )
  fetchMock = jest.fn((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/spaces/members')) return json(owner)
    if (url === '/api/spaces/sp-1/invitations' && init?.method === 'POST') return postResponse()
    if (url === '/api/spaces/sp-1/invitations') return json({ invitations: [] })
    return json({}, 404)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

async function invite() {
  render(<MembersCard />)
  await screen.findByText(/owner@example.com/)
  fireEvent.change(screen.getByPlaceholderText('초대할 이메일'), {
    target: { value: 'invitee@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: '초대 보내기' }))
}

it('OWNER는 구성원 목록과 초대 폼을 보고, 초대하면 링크가 나온다', async () => {
  await invite()
  await waitFor(() =>
    expect(screen.getByDisplayValue('https://app.example.com/invite/TOK')).toBeInTheDocument()
  )
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')
  expect(JSON.parse(post![1].body)).toEqual({ email: 'invitee@example.com', role: 'ADMIN' })
})

it('이미 가입한 이메일이면 메일 미발송 안내와 링크를 보여준다', async () => {
  postResponse = () =>
    json(
      {
        invitationId: 'i',
        link: 'https://app.example.com/invite/T2',
        emailSent: false,
        emailSkipReason: 'already_registered',
      },
      201
    )
  await invite()
  expect(
    await screen.findByText(/이미 가입된 이메일이라 메일을 보내지 않았습니다/)
  ).toBeInTheDocument()
  expect(screen.getByDisplayValue('https://app.example.com/invite/T2')).toBeInTheDocument()
})

it('메일 발송 실패면 실패 안내를 보여준다', async () => {
  postResponse = () =>
    json(
      {
        invitationId: 'i',
        link: 'https://app.example.com/invite/T3',
        emailSent: false,
        emailSkipReason: 'send_failed',
      },
      201
    )
  await invite()
  expect(await screen.findByText(/초대 메일을 보내지 못했습니다/)).toBeInTheDocument()
})

it('stale_resend면 이전 메일 재발송 불가 안내를 보여준다', async () => {
  postResponse = () =>
    json(
      {
        invitationId: 'i',
        link: 'https://app.example.com/invite/T4',
        emailSent: false,
        emailSkipReason: 'stale_resend',
      },
      201
    )
  await invite()
  expect(await screen.findByText(/이전 초대 메일을 다시 보낼 수 없어/)).toBeInTheDocument()
})

it('403이면 API 메시지를 그대로 보여준다', async () => {
  postResponse = () => json({ message: '2단계 인증이 필요합니다' }, 403)
  await invite()
  expect(await screen.findByText('2단계 인증이 필요합니다')).toBeInTheDocument()
})

it('초대 목록이 MFA_REQUIRED 면 메시지 옆에 [인증하기] 링크(현재 경로로 복귀)를 보여준다', async () => {
  window.history.pushState({}, '', '/settings/members')
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/spaces/members')) return json(owner)
    if (url === '/api/spaces/sp-1/invitations')
      return json({ message: '2단계 인증이 필요합니다', code: 'MFA_REQUIRED' }, 403)
    return json({}, 404)
  })
  render(<MembersCard />)
  expect(await screen.findByText(/2단계 인증이 필요합니다/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '인증하기' })).toHaveAttribute(
    'href',
    '/auth/mfa?next=%2Fsettings%2Fmembers'
  )
})

it('초대 목록 403이 MFA 가 아니면 링크가 없다', async () => {
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/spaces/members')) return json(owner)
    if (url === '/api/spaces/sp-1/invitations') return json({ message: '권한 없음' }, 403)
    return json({}, 404)
  })
  render(<MembersCard />)
  expect(await screen.findByText('권한 없음')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: '인증하기' })).toBeNull()
})

it('링크 복사 버튼은 클립보드에 쓴다', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  await invite()
  fireEvent.click(await screen.findByRole('button', { name: '링크 복사' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://app.example.com/invite/TOK'))
})

it('ADMIN은 초대 폼을 보지 않는다', async () => {
  fetchMock.mockImplementation((url: string) =>
    url.startsWith('/api/spaces/members')
      ? json({ spaceId: 'sp-1', myRole: 'ADMIN', members: [] })
      : json({}, 404)
  )
  render(<MembersCard />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(screen.queryByPlaceholderText('초대할 이메일')).not.toBeInTheDocument()
})

it('대기 초대를 취소하면 DELETE 후 목록을 다시 불러온다', async () => {
  let pending = [
    { id: 'inv-9', email: 'p@example.com', role: 'MEMBER', expiresAt: '2026-10-22T00:00:00Z' },
  ]
  jest.spyOn(window, 'confirm').mockReturnValue(true)
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/spaces/members')) return json(owner)
    if (url === '/api/spaces/sp-1/invitations/inv-9' && init?.method === 'DELETE') {
      pending = []
      return json({ ok: true })
    }
    if (url === '/api/spaces/sp-1/invitations') return json({ invitations: pending })
    return json({}, 404)
  })
  render(<MembersCard />)
  fireEvent.click(await screen.findByRole('button', { name: '취소' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/spaces/sp-1/invitations/inv-9', {
      method: 'DELETE',
    })
  )
  await waitFor(() => expect(screen.queryByText(/p@example.com/)).not.toBeInTheDocument())
})

it('구성원 목록 403이면 API 메시지를 보여준다', async () => {
  fetchMock.mockImplementation(() => json({ message: '관리자 이상만 볼 수 있습니다' }, 403))
  render(<MembersCard />)
  expect(await screen.findByText('관리자 이상만 볼 수 있습니다')).toBeInTheDocument()
})

it('네트워크 오류면 안내를 보여준다', async () => {
  fetchMock.mockImplementation(() => Promise.reject(new Error('down')))
  render(<MembersCard />)
  expect(await screen.findByText('네트워크 오류로 요청하지 못했습니다.')).toBeInTheDocument()
})

describe('OWNER 구성원 관리·승인 한도', () => {
  const team = {
    ...owner,
    approvalLimitKrw: 100000,
    members: [
      ...owner.members,
      {
        id: 'm2',
        role: 'ADMIN',
        slackUserId: null,
        user: { email: 'admin@example.com', name: null },
      },
    ],
  }
  beforeEach(() => {
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/spaces/members') return json(team)
      if (url === '/api/spaces/sp-1/invitations') return json({ invitations: [] })
      return json({ ok: true })
    })
  })

  it('OWNER 줄에는 동작이 없고, 다른 구성원은 내보낼 수 있다', async () => {
    render(<MembersCard />)
    await screen.findByText(/admin@example.com/)
    expect(screen.getAllByRole('button', { name: '내보내기' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/spaces/members/m2', { method: 'DELETE' })
    )
  })

  // 회귀: 다른 탭에서 전환해 현재 Space(쿠키)가 바뀌어도 이름은 쓰기 대상(members 응답)의 것.
  it('내보내기 확인 문구와 초대 버튼에 쓰기 대상 Space 이름이 들어간다', async () => {
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url === '/api/spaces/current'
        ? json({ current: { id: 'sp-2', name: 'Space B' } })
        : url.startsWith('/api/spaces/members')
          ? base(url, init).then(async (r: { json: () => Promise<object> }) => {
              const b = await r.json()
              return { ok: true, status: 200, json: async () => ({ ...b, spaceName: 'Space A' }) }
            })
          : base(url, init)
    )
    render(<MembersCard />)
    await screen.findByText(/admin@example.com/)
    expect(await screen.findByRole('button', { name: '「Space A」에 초대' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '「Space B」에 초대' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
    expect(window.confirm).toHaveBeenCalledWith(
      '「Space A」에서 admin@example.com 님을 내보낼까요?'
    )
  })

  it('승인 한도를 저장하면 PUT 으로 보낸다', async () => {
    render(<MembersCard />)
    const input = await screen.findByLabelText('ADMIN 승인 한도(원)')
    expect(input).toHaveValue('100000')
    fireEvent.change(input, { target: { value: '50,000' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')
      expect(put?.[0]).toBe('/api/spaces/sp-1/approval-limit')
      expect(JSON.parse(put![1].body)).toEqual({ approvalLimitKrw: 50000 })
    })
    fireEvent.click(screen.getByRole('button', { name: '한도 없음' }))
    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT')
      expect(JSON.parse(puts[1][1].body)).toEqual({ approvalLimitKrw: null })
    })
  })

  it('MFA 가 필요하면 단계 인증으로 보내고 오류를 띄우지 않는다', async () => {
    render(<MembersCard />)
    await screen.findByText(/admin@example.com/)
    mfaRedirect.mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await waitFor(() => expect(mfaRedirect).toHaveBeenCalled())
    expect(screen.queryByText(/내보내지 못했습니다/)).not.toBeInTheDocument()
  })

  it('ADMIN 은 한도를 읽기만 하고 구성원 동작이 없다', async () => {
    fetchMock.mockImplementation(() => json({ ...team, myRole: 'ADMIN' }))
    render(<MembersCard />)
    expect(await screen.findByText('100,000원')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '내보내기' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ADMIN 승인 한도(원)')).not.toBeInTheDocument()
  })
})
