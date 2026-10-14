import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MembersCard } from '../members-card'

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('spaceId=sp-1'),
  usePathname: () => '/settings/members',
}))

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
