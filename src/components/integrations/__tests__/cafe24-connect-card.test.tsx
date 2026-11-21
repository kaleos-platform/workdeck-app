import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Cafe24ConnectCard } from '../cafe24-connect-card'

jest.mock('@/hooks/use-current-space', () => ({
  useCurrentSpace: () => ({ id: 'sp-a', name: 'Space A' }),
}))
const fetchWithMfa = jest.fn()
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: unknown[]) => fetchWithMfa(...a),
  redirectIfMfaRequired: async () => false,
}))

const res = (status: number, body: unknown) => ({
  status,
  ok: status < 300,
  json: async () => body,
})
const status = (appConfigured: boolean, malls: unknown[]) =>
  res(200, { appConfigured, limit: 5, malls })
const mall = (mallId: string, s: string) => ({
  mallId,
  status: s,
  connectedAt: null,
  scopes: [],
  error: null,
})
const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchWithMfa.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

it('쇼핑몰 목록과 N / 5 를 보여주고, 상태별 승인 버튼 문구가 다르다', async () => {
  fetchMock.mockResolvedValueOnce(status(true, [mall('a', 'connected'), mall('b', 'needs_auth')]))
  render(<Cafe24ConnectCard result={null} resultMall="b" />)
  expect(await screen.findByText('2 / 5')).toBeTruthy()
  expect(screen.getByText('연결됨')).toBeTruthy()
  expect(screen.getByText('다시 승인')).toBeTruthy()
  expect(screen.getByText('카페24에서 승인')).toBeTruthy()
})

it('첫 몰 추가는 앱 정보와 함께 PUT 하고 쇼핑몰 ID 를 소문자로 보낸다', async () => {
  fetchMock.mockResolvedValue(status(false, []))
  fetchWithMfa.mockResolvedValueOnce(res(200, { ok: true }))
  render(<Cafe24ConnectCard result={null} />)
  fireEvent.click(await screen.findByRole('button', { name: '+ 쇼핑몰 추가' }))
  fireEvent.change(screen.getByLabelText('쇼핑몰 ID'), { target: { value: 'MyShop' } })
  fireEvent.change(screen.getByLabelText('클라이언트 ID (client_id)'), { target: { value: 'cid' } })
  fireEvent.change(screen.getByLabelText('클라이언트 시크릿 (client_secret)'), {
    target: { value: 'sec' },
  })
  fireEvent.click(screen.getByRole('button', { name: '추가' }))
  await waitFor(() => expect(fetchWithMfa).toHaveBeenCalled())
  const [url, init] = fetchWithMfa.mock.calls[0]
  expect(url).toBe('/api/spaces/sp-a/credentials/cafe24')
  expect(JSON.parse(init.body)).toEqual({
    config: { mallId: 'myshop' },
    secret: { clientId: 'cid', clientSecret: 'sec' },
  })
})

it('삭제 409 는 해당 행 아래에 서버 메시지를 보여준다', async () => {
  fetchMock.mockResolvedValue(status(true, [mall('a', 'connected')]))
  fetchWithMfa.mockResolvedValueOnce(res(409, { message: '채널이 사용 중입니다' }))
  render(<Cafe24ConnectCard result={null} />)
  fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === '삭제')!
  )
  expect((await screen.findByRole('alert')).textContent).toBe('채널이 사용 중입니다')
  expect(fetchWithMfa.mock.calls[0][0]).toBe('/api/spaces/sp-a/credentials/cafe24?mallId=a')
})
