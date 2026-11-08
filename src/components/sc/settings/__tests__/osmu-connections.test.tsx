import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { OsmuConnections } from '../osmu-connections'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
const redirect = jest.fn()
jest.mock('@/lib/auth/mfa-client', () => ({
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

  it('MFA 필요 응답이면 단계 인증으로 보내고 오류 토스트는 띄우지 않는다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null }))
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
      .mockResolvedValueOnce(reply(200, { notion: null, drive: null }))
      .mockResolvedValueOnce(
        reply(400, { message: '노션 데이터베이스 링크를 확인해주세요' })
      ) as never
    await submit()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('노션 데이터베이스 링크를 확인해주세요')
    )
  })
})
