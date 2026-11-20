import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { MembersCard } from '../members-card'

// next/navigation 모킹 — replace 가 주소를 바꾸면 useSearchParams 를 쓰는 컴포넌트가 다시 그려진다.
jest.mock('next/navigation', () => {
  const React = jest.requireActual('react')
  const listeners = new Set<() => void>()
  const store = { search: '' }
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }
  return {
    __store: store,
    __setSearch: (q: string) => {
      store.search = q
      listeners.forEach((l) => l())
    },
    usePathname: () => '/settings/members',
    useRouter: () => ({
      replace: (url: string) => {
        mockReplace(url)
        store.search = url.split('?')[1] ?? ''
        listeners.forEach((l) => l())
      },
    }),
    useSearchParams: () => {
      const search = React.useSyncExternalStore(
        subscribe,
        () => store.search,
        () => store.search
      )
      return new URLSearchParams(search)
    },
  }
})
const mockReplace = jest.fn()
const nav = jest.requireMock('next/navigation') as { __setSearch: (q: string) => void }

jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: Parameters<typeof fetch>) => fetch(...a),
  redirectIfMfaRequired: jest.fn(),
}))
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

const pendingInv = {
  id: 'inv-1',
  email: 'p@example.com',
  role: 'MEMBER',
  state: 'pending',
  expiresAt: '2026-11-22T00:00:00Z',
  createdAt: '2026-11-15T00:00:00Z',
  lastSentAt: '2026-11-15T01:00:00Z',
  sendCount: 1,
  lastSendFailed: false,
  acceptedAt: null,
  revokedAt: null,
}

beforeEach(() => {
  nav.__setSearch('')
  mockReplace.mockClear()
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
  fireEvent.click(screen.getByRole('button', { name: '팀원 초대' }))
  fireEvent.change(await screen.findByPlaceholderText('초대할 이메일'), {
    target: { value: 'invitee@example.com' },
  })
  fireEvent.click(screen.getByRole('button', { name: '초대 보내기' }))
}

it('OWNER는 팝업으로 초대하면 팝업이 닫히고 초대 탭에 링크가 나온다', async () => {
  await invite()
  await waitFor(() =>
    expect(screen.getByDisplayValue('https://app.example.com/invite/TOK')).toBeInTheDocument()
  )
  const post = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')
  expect(JSON.parse(post![1].body)).toEqual({ email: 'invitee@example.com', role: 'ADMIN' })
  expect(mockReplace).toHaveBeenCalledWith('/settings/members?tab=invites')
  expect(screen.queryByPlaceholderText('초대할 이메일')).not.toBeInTheDocument()
  expect(screen.getByRole('tab', { name: '초대', selected: true })).toBeInTheDocument()
})

it('메일 발송 성공 안내(링크는 보조)', async () => {
  await invite()
  expect(
    await screen.findByText('초대 메일을 보냈습니다. 메일이 오지 않으면 아래 링크를 전달하세요.')
  ).toBeInTheDocument()
})

it('이미 대기 중인 초대를 다시 보냈으면(resent) 그 안내', async () => {
  postResponse = () =>
    json(
      {
        invitationId: 'i',
        resent: true,
        link: 'https://app.example.com/invite/T2',
        emailSent: true,
      },
      200
    )
  await invite()
  expect(await screen.findByText('이미 대기 중인 초대가 있어 다시 보냈습니다.')).toBeInTheDocument()
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
  expect(await screen.findByText(/메일을 보내지 못했습니다/)).toBeInTheDocument()
})

it('403이면 API 메시지를 그대로 보여준다', async () => {
  postResponse = () => json({ message: '2단계 인증이 필요합니다' }, 403)
  await invite()
  const msg = await screen.findByText('2단계 인증이 필요합니다')
  expect(within(screen.getByRole('dialog')).getByText('2단계 인증이 필요합니다')).toBe(msg)
})

it('초대 목록 로드 실패는 메시지만, 인증 링크는 없다', async () => {
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

it('ADMIN은 탭 2개만 보고 초대 버튼·역할 Select 가 없다', async () => {
  fetchMock.mockImplementation((url: string) =>
    url.startsWith('/api/spaces/members')
      ? json({
          ...owner,
          myRole: 'ADMIN',
          members: [
            ...owner.members,
            {
              id: 'm2',
              role: 'MEMBER',
              slackUserId: null,
              user: { email: 'mem@example.com', name: null },
            },
          ],
        })
      : json({}, 404)
  )
  render(<MembersCard />)
  await screen.findByText(/mem@example.com/)
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['팀원·권한', '승인 규칙'])
  expect(screen.queryByRole('button', { name: '팀원 초대' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalledWith('/api/spaces/sp-1/invitations')
})

it('ADMIN 이 ?tab=invites 로 들어오면 팀원·권한 탭', async () => {
  nav.__setSearch('tab=invites')
  fetchMock.mockImplementation(() => json({ ...owner, myRole: 'ADMIN' }))
  render(<MembersCard />)
  expect(await screen.findByRole('tab', { name: '팀원·권한', selected: true })).toBeInTheDocument()
})

describe('탭 URL', () => {
  it('OWNER 는 탭 3개와 초대 버튼을 본다(기본 팀원·권한, 역할 안내 포함)', async () => {
    render(<MembersCard />)
    await screen.findByText(/owner@example.com/)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      '팀원·권한',
      '초대',
      '승인 규칙',
    ])
    expect(screen.getByRole('tab', { name: '팀원·권한', selected: true })).toBeInTheDocument()
    expect(screen.getByText('결제·구독과 모든 설정을 관리합니다')).toBeInTheDocument()
  })

  it('?tab=invites 로 시작하면 초대 탭, 대기 건수가 라벨에 붙는다', async () => {
    nav.__setSearch('tab=invites')
    fetchMock.mockImplementation((url: string) =>
      url.startsWith('/api/spaces/members') ? json(owner) : json({ invitations: [pendingInv] })
    )
    render(<MembersCard />)
    expect(await screen.findByRole('tab', { name: '초대 (1)', selected: true })).toBeInTheDocument()
    expect(await screen.findByText(/^p@example.com/)).toBeInTheDocument()
  })

  it('같은 화면에서 주소가 바뀌면 선택 탭이 따라간다', async () => {
    render(<MembersCard />)
    await screen.findByText(/owner@example.com/)
    act(() => nav.__setSearch('tab=rules'))
    expect(screen.getByRole('tab', { name: '승인 규칙', selected: true })).toBeInTheDocument()
  })

  it('허용하지 않는 tab 값은 팀원·권한', async () => {
    nav.__setSearch('tab=zzz')
    render(<MembersCard />)
    expect(
      await screen.findByRole('tab', { name: '팀원·권한', selected: true })
    ).toBeInTheDocument()
  })

  it('탭을 바꾸면 다른 query 를 보존해 replace 한다', async () => {
    nav.__setSearch('foo=1&tab=members')
    render(<MembersCard />)
    await screen.findByText(/owner@example.com/)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '승인 규칙' }), { button: 0 })
    expect(mockReplace).toHaveBeenCalledWith('/settings/members?foo=1&tab=rules')
  })
})

it('대기 초대를 취소하면 DELETE 후 목록을 다시 불러온다', async () => {
  let pending = [{ ...pendingInv, id: 'inv-9', email: 'p@example.com' }]
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
  nav.__setSearch('tab=invites')
  render(<MembersCard />)
  fireEvent.click(await screen.findByRole('button', { name: '취소' }))
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith('/api/spaces/sp-1/invitations/inv-9', {
      method: 'DELETE',
    })
  )
  await waitFor(() => expect(screen.queryByText(/p@example.com/)).not.toBeInTheDocument())
})

it('취소가 2단계 인증을 요구하면 단계 인증으로 보낸다(목록은 AAL2 없이 보임)', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true)
  mfaRedirect.mockResolvedValue(true)
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/spaces/members')) return json(owner)
    if (init?.method === 'DELETE') return json({ code: 'MFA_REQUIRED' }, 403)
    if (url === '/api/spaces/sp-1/invitations')
      return json({ invitations: [{ ...pendingInv, id: 'inv-9', email: 'p@example.com' }] })
    return json({}, 404)
  })
  nav.__setSearch('tab=invites')
  render(<MembersCard />)
  fireEvent.click(await screen.findByRole('button', { name: '취소' }))
  await waitFor(() => expect(mfaRedirect).toHaveBeenCalled())
  expect(screen.queryByText('초대를 취소하지 못했습니다')).not.toBeInTheDocument()
  mfaRedirect.mockReset()
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
  it('내보내기 확인 문구와 초대 팝업에 쓰기 대상 Space 이름이 들어간다', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '내보내기' }))
    expect(window.confirm).toHaveBeenCalledWith(
      '「Space A」에서 admin@example.com 님을 내보낼까요?'
    )
    fireEvent.click(screen.getByRole('button', { name: '팀원 초대' }))
    expect(await screen.findByText(/「Space A」에 초대할 사람/)).toBeInTheDocument()
    expect(screen.queryByText(/Space B/)).toBeNull()
  })

  it('승인 한도를 저장하면 PUT 으로 보낸다', async () => {
    nav.__setSearch('tab=rules')
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
    nav.__setSearch('tab=rules')
    render(<MembersCard />)
    fireEvent.mouseDown(await screen.findByRole('tab', { name: '승인 규칙' }), { button: 0 })
    expect(await screen.findByText('100,000원')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '내보내기' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ADMIN 승인 한도(원)')).not.toBeInTheDocument()
  })
})

describe('초대 상태 목록·다시 보내기', () => {
  const rows = [
    { ...pendingInv, id: 'p', email: 'p@example.com', lastSendFailed: true },
    {
      ...pendingInv,
      id: 'a',
      email: 'a@example.com',
      state: 'accepted',
      acceptedAt: '2026-11-16T00:00:00Z',
    },
    { ...pendingInv, id: 'e', email: 'e@example.com', state: 'expired' },
    {
      ...pendingInv,
      id: 'r',
      email: 'r@example.com',
      role: 'ADMIN',
      state: 'revoked',
      revokedAt: '2026-11-16T00:00:00Z',
    },
  ]
  beforeEach(() => {
    nav.__setSearch('tab=invites')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/spaces/members')) return json(owner)
      if (url === '/api/spaces/sp-1/invitations/p/resend' && init?.method === 'POST')
        return json({
          link: 'https://app.example.com/invite/NEW',
          emailSent: true,
          expiresAt: '2026-11-23T00:00:00Z',
        })
      if (url === '/api/spaces/sp-1/invitations' && init?.method === 'POST') return postResponse()
      if (url === '/api/spaces/sp-1/invitations') return json({ invitations: rows })
      return json({}, 404)
    })
  })
  const row = (email: string) =>
    screen.getByText(new RegExp(`^${email}`)).closest('li') as HTMLElement

  it('상태 배지와 메일 실패 표시', async () => {
    render(<MembersCard />)
    await screen.findByText(/p@example.com/)
    expect(within(row('p@example.com')).getByText('대기')).toBeInTheDocument()
    expect(within(row('p@example.com')).getByText('메일 실패')).toBeInTheDocument()
    expect(within(row('a@example.com')).getByText('수락')).toBeInTheDocument()
    expect(within(row('e@example.com')).getByText('만료')).toBeInTheDocument()
    expect(within(row('r@example.com')).getByText('취소')).toBeInTheDocument()
  })

  it('버튼 노출 규칙: 대기=다시 보내기·취소, 만료·취소=다시 초대, 수락=없음', async () => {
    render(<MembersCard />)
    await screen.findByText(/p@example.com/)
    const names = (email: string) =>
      within(row(email))
        .queryAllByRole('button')
        .map((b) => b.textContent)
    expect(names('p@example.com')).toEqual(['다시 보내기', '취소'])
    expect(names('a@example.com')).toEqual([])
    expect(names('e@example.com')).toEqual(['다시 초대'])
    expect(names('r@example.com')).toEqual(['다시 초대'])
  })

  it('다시 보내기는 resend 를 호출하고 새 링크·안내를 보여준다', async () => {
    render(<MembersCard />)
    await screen.findByText(/p@example.com/)
    fireEvent.click(within(row('p@example.com')).getByRole('button', { name: '다시 보내기' }))
    expect(
      await screen.findByText('초대 메일을 보냈습니다. 메일이 오지 않으면 아래 링크를 전달하세요.')
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('https://app.example.com/invite/NEW')).toBeInTheDocument()
  })

  it('다시 보내기 메일 실패도 초대 탭 Alert 에 실패 안내와 링크로 나온다', async () => {
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      url.endsWith('/p/resend')
        ? json({ link: 'https://app.example.com/invite/FAIL', emailSent: false })
        : base(url, init)
    )
    render(<MembersCard />)
    await screen.findByText(/p@example.com/)
    fireEvent.click(within(row('p@example.com')).getByRole('button', { name: '다시 보내기' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/메일을 보내지 못했습니다/)).toBeInTheDocument()
    expect(
      within(alert).getByDisplayValue('https://app.example.com/invite/FAIL')
    ).toBeInTheDocument()
  })

  it('다시 보내기 쿨다운 오류는 서버 메시지 그대로', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/spaces/members')) return json(owner)
      if (url.endsWith('/resend'))
        return json({ message: '방금 보냈습니다. 1분 뒤에 다시 보내세요' }, 429)
      return json({ invitations: rows })
    })
    render(<MembersCard />)
    await screen.findByText(/p@example.com/)
    fireEvent.click(within(row('p@example.com')).getByRole('button', { name: '다시 보내기' }))
    expect(await screen.findByText('방금 보냈습니다. 1분 뒤에 다시 보내세요')).toBeInTheDocument()
  })

  it('다시 초대는 그 이메일·역할로 초대 POST(AAL2 경로)를 보낸다', async () => {
    render(<MembersCard />)
    await screen.findByText(/^r@example.com/)
    fireEvent.click(within(row('r@example.com')).getByRole('button', { name: '다시 초대' }))
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, i]) => u === '/api/spaces/sp-1/invitations' && i?.method === 'POST'
      )
      expect(JSON.parse(post![1].body)).toEqual({ email: 'r@example.com', role: 'ADMIN' })
    })
  })
})
