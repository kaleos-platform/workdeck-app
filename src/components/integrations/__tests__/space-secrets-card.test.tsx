import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SpaceSecretsCard } from '../space-secrets-card'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'

jest.mock('@/lib/auth/mfa-client', () => ({ redirectIfMfaRequired: jest.fn(async () => false) }))

const KEY = 'SK_TEST_0123456789abcdef'
const res = (body: unknown, status = 200) => {
  const r = { ok: status < 400, status, json: async () => body, clone: () => r }
  return Promise.resolve(r)
}
const config = {
  baseUrl: 'https://api.example.com',
  auth: { in: 'header', name: 'X-Api-Key', template: 'Key {value}' },
  readOps: [{ id: 'list_orders', method: 'GET', pathPattern: '/orders', query: {} }],
}
const secret = {
  name: 'COUPANG_KEY',
  kind: 'API_KEY',
  config,
  baseUrl: 'https://api.example.com',
  readOpIds: ['list_orders', 'get_order'],
  allowedAgentIds: ['ag1'],
  revision: 1,
  lastUsedAt: null,
  lastError: '업스트림 401',
  updatedAt: '2026-10-01T00:00:00Z',
}
const agents = [
  { id: 'ag1', name: '에이전트 A', status: 'ACTIVE', kind: 'agent' },
  { id: 'ag2', name: '에이전트 B', status: 'DISABLED' },
  { id: 'ag3', name: '에이전트 C', status: 'PENDING' },
  { id: 'ag4', name: '연동 D', status: 'ACTIVE', kind: 'integration' },
]
let fetchMock: jest.Mock

beforeEach(() => {
  ;(redirectIfMfaRequired as jest.Mock).mockClear()
  fetchMock = jest.fn((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/spaces/members')) return res({ spaceId: 'sp-1', spaceName: 'Space A' })
    if (url === '/api/spaces/sp-1/agents') return res({ agents })
    if (url === '/api/spaces/sp-1/env-secrets')
      return init?.method === 'PATCH'
        ? res({ envSecretsEnabled: true, canManage: true })
        : res({ envSecretsEnabled: false, canManage: true })
    if (url === '/api/spaces/sp-1/secrets') return res({ secrets: [secret] })
    if (url === '/api/spaces/sp-1/secrets/COUPANG_KEY/reveal' && init?.method === 'POST')
      return res({ value: KEY })
    if (url.startsWith('/api/spaces/sp-1/secrets/') && init?.method === 'PUT')
      return res({ name: 'NEW_KEY', revision: 1 })
    return res({}, 404)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.useRealTimers())

const putCall = () => fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')

// spaceId를 불러와 버튼이 활성화된 뒤에 연다.
async function openRegister() {
  await screen.findByText('「Space A」 비밀값')
  fireEvent.click(screen.getByRole('button', { name: '비밀값 등록' }))
}

async function fillAndSave() {
  await openRegister()
  fireEvent.change(await screen.findByLabelText('이름'), { target: { value: 'NEW_KEY' } })
  fireEvent.change(screen.getByLabelText('값'), { target: { value: KEY } })
  fireEvent.change(screen.getByLabelText('baseUrl'), { target: { value: 'https://api.x.com' } })
  fireEvent.click(await screen.findByLabelText('에이전트 A'))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
}

it('제목에 Space 이름이 보이고 목록에는 메타만 나온다(값 없음)', async () => {
  const { container } = render(<SpaceSecretsCard />)
  expect(await screen.findByText('「Space A」 비밀값')).toBeInTheDocument()
  expect(screen.getByText('COUPANG_KEY')).toBeInTheDocument()
  expect(screen.getByText('https://api.example.com')).toBeInTheDocument()
  expect(screen.getByText('에이전트 A')).toBeInTheDocument()
  expect(screen.getByText('업스트림 401')).toBeInTheDocument()
  expect(container.textContent).not.toContain(KEY)
})

it('등록 PUT body에 입력값이 들어가고 성공하면 값 입력이 비워진다', async () => {
  render(<SpaceSecretsCard />)
  await fillAndSave()
  await waitFor(() => expect(putCall()).toBeTruthy())
  expect(putCall()![0]).toBe('/api/spaces/sp-1/secrets/NEW_KEY')
  const body = JSON.parse(putCall()![1].body)
  expect(body.kind).toBe('API_KEY')
  expect(body.value).toBe(KEY)
  expect(body.config.baseUrl).toBe('https://api.x.com')
  expect(body.allowedAgentIds).toEqual(['ag1'])
  await waitFor(() => expect(screen.queryByLabelText('값')).not.toBeInTheDocument())
  expect(screen.queryByDisplayValue(KEY)).not.toBeInTheDocument()
})

it('비활성 에이전트는 허용 선택지에 없다', async () => {
  render(<SpaceSecretsCard />)
  await openRegister()
  expect(await screen.findByLabelText('에이전트 A')).toBeInTheDocument()
  expect(screen.queryByLabelText('에이전트 B')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('에이전트 C')).not.toBeInTheDocument()
})

it('readOps JSON이 깨지면 요청 없이 오류를 보이고, 서버 오류 메시지는 그대로 보인다', async () => {
  render(<SpaceSecretsCard />)
  await openRegister()
  fireEvent.change(await screen.findByLabelText('readOps(JSON)'), { target: { value: '{' } })
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'NEW_KEY' } })
  fireEvent.change(screen.getByLabelText('값'), { target: { value: KEY } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('readOps가 올바른 JSON이 아닙니다')).toBeInTheDocument()
  expect(putCall()).toBeUndefined()

  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    init?.method === 'PUT' ? res({ message: 'baseUrl은 https 도메인만 허용합니다' }, 400) : res({})
  )
  fireEvent.change(screen.getByLabelText('readOps(JSON)'), { target: { value: '[]' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('baseUrl은 https 도메인만 허용합니다')).toBeInTheDocument()
})

it('PUT이 MFA 403이면 MFA 경로 이동을 맡기고 오류를 띄우지 않는다', async () => {
  ;(redirectIfMfaRequired as jest.Mock).mockResolvedValueOnce(true)
  render(<SpaceSecretsCard />)
  await fillAndSave()
  await waitFor(() => expect(redirectIfMfaRequired).toHaveBeenCalled())
  expect(screen.queryByText('저장하지 못했습니다')).not.toBeInTheDocument()
})

it('보기 후 30초가 지나면 값이 DOM에서 사라진다', async () => {
  jest.useFakeTimers()
  render(<SpaceSecretsCard />)
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })
  fireEvent.click(await screen.findByRole('button', { name: '보기' }))
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByText(KEY)).toBeInTheDocument()
  await act(async () => {
    await jest.advanceTimersByTimeAsync(29_000)
  })
  expect(screen.getByText(KEY)).toBeInTheDocument()
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1_000)
  })
  expect(screen.queryByText(KEY)).not.toBeInTheDocument()
})

it('삭제는 확인 뒤 DELETE를 보낸다', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(true)
  render(<SpaceSecretsCard />)
  fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
  await waitFor(() =>
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true)
  )
})

it('허용 목록의 비활성 에이전트도 배지에는 이름으로 보인다', async () => {
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/spaces/sp-1/secrets'
      ? res({ secrets: [{ ...secret, allowedAgentIds: ['ag2'] }] })
      : base(url, init)
  )
  render(<SpaceSecretsCard />)
  expect(await screen.findByText('에이전트 B')).toBeInTheDocument()
  expect(screen.queryByText('ag2')).not.toBeInTheDocument()
})

it('교체 대화상자는 기존 설정·허용 에이전트를 미리 채우고 값은 비어 있다', async () => {
  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/spaces/sp-1/secrets'
      ? res({ secrets: [{ ...secret, allowedAgentIds: ['ag1', 'ag2'] }] })
      : base(url, init)
  )
  render(<SpaceSecretsCard />)
  fireEvent.click(await screen.findByRole('button', { name: '교체' }))
  expect(await screen.findByLabelText('baseUrl')).toHaveValue('https://api.example.com')
  expect(screen.getByLabelText('인증 이름')).toHaveValue('X-Api-Key')
  expect(screen.getByLabelText('template')).toHaveValue('Key {value}')
  expect(JSON.parse((screen.getByLabelText('readOps(JSON)') as HTMLTextAreaElement).value)).toEqual(
    config.readOps
  )
  expect(screen.getByLabelText('에이전트 A')).toBeChecked()
  expect(screen.getByLabelText('값')).toHaveValue('')
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()

  fireEvent.change(screen.getByLabelText('값'), { target: { value: KEY } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(putCall()).toBeTruthy())
  const body = JSON.parse(putCall()![1].body)
  expect(body.config).toEqual(config)
  // 비활성(ag2)은 PUT이 거부하므로 빠진다
  expect(body.allowedAgentIds).toEqual(['ag1'])
})

const CONFIRM =
  '이 키는 읽기 전용이고 대상이 한정돼 있음을 확인했습니다. Supabase service role, 운영 DB URL, ENCRYPTION_KEY, Vercel·GitHub 쓰기 토큰 같은 쓰기 키는 등록하지 마세요.'

async function openEnv() {
  await openRegister()
  fireEvent.change(await screen.findByLabelText('종류'), { target: { value: 'ENV' } })
}

it('종류 ENV 선택 시 envName·용도·만료일·읽기 전용 확인 체크박스가 보이고, 체크 전에는 저장 비활성', async () => {
  render(<SpaceSecretsCard />)
  await openEnv()
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'VERCEL_READ' } })
  fireEvent.change(screen.getByLabelText('값'), { target: { value: KEY } })
  fireEvent.change(screen.getByLabelText('환경변수 이름'), {
    target: { value: 'VERCEL_READ_TOKEN' },
  })
  fireEvent.change(screen.getByLabelText('용도'), { target: { value: '배포 조회' } })
  fireEvent.change(screen.getByLabelText('만료일'), { target: { value: '2026-12-31' } })
  expect(screen.queryByLabelText('baseUrl')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  fireEvent.click(screen.getByLabelText(CONFIRM))
  expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(putCall()).toBeTruthy())
  const body = JSON.parse(putCall()![1].body)
  expect(body).toEqual({
    kind: 'ENV',
    value: KEY,
    config: {
      envName: 'VERCEL_READ_TOKEN',
      scopeNote: '배포 조회',
      expiresAt: new Date('2026-12-31T23:59:59+09:00').toISOString(),
      readOnlyConfirmed: true,
    },
    allowedAgentIds: [],
  })
})

it('ENV 허용 에이전트 목록에 integration은 없다', async () => {
  render(<SpaceSecretsCard />)
  await openEnv()
  expect(await screen.findByLabelText('에이전트 A')).toBeInTheDocument()
  expect(screen.queryByLabelText('연동 D')).not.toBeInTheDocument()
})

it('ENV 행은 envName과 만료일을 보여 준다', async () => {
  const base = fetchMock.getMockImplementation()!
  const env = (name: string, expiresAt: string) => ({
    ...secret,
    name,
    kind: 'ENV',
    config: { envName: 'VERCEL_READ_TOKEN', scopeNote: 'x', expiresAt },
    baseUrl: null,
    readOpIds: [],
  })
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/spaces/sp-1/secrets'
      ? res({
          secrets: [env('E1', '2099-12-31T14:59:59.000Z'), env('E2', '2020-01-01T14:59:59.000Z')],
        })
      : base(url, init)
  )
  render(<SpaceSecretsCard />)
  expect(await screen.findByText('만료 2099-12-31')).toBeInTheDocument()
  expect(screen.getAllByText(/VERCEL_READ_TOKEN/)).toHaveLength(2)
  expect(screen.getByText('만료 2020-01-01')).toBeInTheDocument()
  expect(screen.getAllByText('만료됨')).toHaveLength(1)
})

it('OWNER에게만 wd run 허용 스위치가 보이고 토글은 PATCH 결과를 반영한다', async () => {
  const { unmount } = render(<SpaceSecretsCard />)
  const sw = await screen.findByRole('switch', { name: 'wd run 허용(개발 키 발급)' })
  expect(sw).not.toBeChecked()
  fireEvent.click(sw)
  await waitFor(() => expect(sw).toBeChecked())
  const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!
  expect(JSON.parse(patch[1].body)).toEqual({ envSecretsEnabled: true })
  unmount()

  const base = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    url === '/api/spaces/sp-1/env-secrets'
      ? res({ envSecretsEnabled: false, canManage: false })
      : base(url, init)
  )
  render(<SpaceSecretsCard />)
  await screen.findByText('「Space A」 비밀값')
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})
