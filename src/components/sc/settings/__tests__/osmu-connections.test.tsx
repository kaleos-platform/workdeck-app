import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { OsmuConnections } from '../osmu-connections'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
const redirect = jest.fn()
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: Parameters<typeof fetch>) => fetch(...a),
  redirectIfMfaRequired: async (res: {
    status: number
    clone: () => { json: () => Promise<{ code?: string }> }
  }) => {
    const body = await res.clone().json()
    if (res.status === 403 && body.code === 'MFA_REQUIRED') {
      redirect()
      return true
    }
    return false
  },
}))

// jsdom 엔 Response 가 없다 — 화면이 쓰는 필드만 흉내 낸다.
function reply(status: number, body: object) {
  const res = { status, ok: status < 400, json: async () => body, clone: () => res }
  return res
}

async function submit() {
  render(<OsmuConnections />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  fireEvent.change(screen.getByLabelText(/통합 토큰/), { target: { value: 'ntn_xxxxxxxxxxxx' } })
  fireEvent.change(screen.getByLabelText(/콘텐츠 소재/), { target: { value: 'a' } })
  fireEvent.change(screen.getByLabelText(/콘텐츠 발행/), { target: { value: 'b' } })
  fireEvent.click(screen.getByRole('button', { name: '연결하기' }))
}

describe('OsmuConnections', () => {
  beforeEach(() => jest.clearAllMocks())

  it('단계 인증 전이면 입력을 잠그고 인증 버튼부터 보여준다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null, mfaReady: false })) as never
    render(<OsmuConnections />)
    const link = await screen.findByRole('link', { name: '2단계 인증하기' })
    expect(link.getAttribute('href')).toMatch(/^\/auth\/mfa\?next=/)
    expect(screen.getByLabelText(/통합 토큰/)).toBeDisabled()
    expect(screen.getByRole('button', { name: '드라이브 계정 만들기' })).toBeDisabled()
  })

  it('MFA 필요 응답이면 단계 인증으로 보내고 오류 토스트는 띄우지 않는다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null, mfaReady: true }))
      .mockResolvedValueOnce(
        reply(403, { message: '2단계 인증이 필요합니다', code: 'MFA_REQUIRED' })
      ) as never
    await submit()
    await waitFor(() => expect(redirect).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('서버 오류 메시지(message)를 그대로 보여준다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null, mfaReady: true }))
      .mockResolvedValueOnce(
        reply(400, { message: '노션 데이터베이스 링크를 확인해주세요' })
      ) as never
    await submit()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('노션 데이터베이스 링크를 확인해주세요')
    )
  })

  it('상태 조회가 403이면 서버 메시지를 화면에 보여준다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(403, { message: '권한이 없습니다' })) as never
    render(<OsmuConnections />)
    expect(await screen.findByText('권한이 없습니다')).toBeInTheDocument()
  })

  it('저장이 402면 서버 메시지를 화면에도 보여준다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null, mfaReady: true }))
      .mockResolvedValueOnce(reply(402, { message: '구독이 만료되었습니다' })) as never
    await submit()
    expect(await screen.findByText('구독이 만료되었습니다')).toBeInTheDocument()
  })

  it('only="drive"면 드라이브 섹션만 그린다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null, mfaReady: true })) as never
    render(<OsmuConnections only="drive" embedded />)
    expect(await screen.findByRole('button', { name: '드라이브 계정 만들기' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/통합 토큰/)).toBeNull()
    expect(screen.queryByText(/구글 드라이브 — 사진/)).toBeNull()
  })
})
