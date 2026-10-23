import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createClient } from '@/lib/supabase/client'
import { MfaStepUp } from '../mfa-step-up'

const replace = jest.fn()
let searchStr = 'next=/admin'
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(searchStr),
}))
jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn() }))

// Supabase enroll() 응답 형태 — qr_code 는 이미 data URI 다.
const QR = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>'

const NOW = Math.floor(Date.now() / 1000)
const FRESH_AAL = {
  currentLevel: 'aal2',
  nextLevel: 'aal2',
  currentAuthenticationMethods: [{ method: 'totp', timestamp: NOW - 3 * 86400 }],
}
const AAL1 = { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] }

function mockAuth(
  factors: Array<{ id: string; factor_type: string; status: string }>,
  aal: object = AAL1
) {
  const mfa = {
    getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({ data: aal, error: null }),
    listFactors: jest.fn().mockResolvedValue({ data: { all: factors, totp: [] }, error: null }),
    unenroll: jest.fn().mockResolvedValue({ data: {}, error: null }),
    enroll: jest.fn().mockResolvedValue({
      data: {
        id: 'f-new',
        type: 'totp',
        friendly_name: 'x',
        totp: { qr_code: QR, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' },
      },
      error: null,
    }),
    challengeAndVerify: jest.fn().mockResolvedValue({ data: {}, error: null }),
  }
  ;(createClient as jest.Mock).mockReturnValue({ auth: { mfa, signOut: jest.fn() } })
  return mfa
}

beforeEach(() => {
  searchStr = 'next=/admin'
  replace.mockClear()
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
})

test('factor 가 없으면 등록 QR(반환값 그대로)과 수동 입력 키를 보여주고, 검증 후 next 로 이동', async () => {
  const mfa = mockAuth([])
  render(<MfaStepUp />)
  const img = await screen.findByAltText('TOTP QR 코드')
  expect(img.getAttribute('src')).toBe(QR)
  expect(screen.getByDisplayValue('JBSWY3DPEHPK3PXP')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
  })
  expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-new', code: '123456' })
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin'))
  expect(mfa.enroll).toHaveBeenCalledTimes(1)
})

test('verified factor 가 있으면 등록 없이 코드만 확인한다', async () => {
  const mfa = mockAuth([{ id: 'f1', factor_type: 'totp', status: 'verified' }])
  render(<MfaStepUp />)
  await waitFor(() => expect(mfa.listFactors).toHaveBeenCalled())
  expect(screen.queryByAltText('TOTP QR 코드')).toBeNull()
  expect(mfa.enroll).not.toHaveBeenCalled()
})

test('StrictMode 이중 마운트에서도 enroll 은 한 번만', async () => {
  const mfa = mockAuth([])
  render(
    <StrictMode>
      <MfaStepUp />
    </StrictMode>
  )
  await screen.findByAltText('TOTP QR 코드')
  expect(mfa.enroll).toHaveBeenCalledTimes(1)
})

test('로그아웃 링크로 단계 인증을 빠져나갈 수 있다', async () => {
  mockAuth([{ id: 'f1', factor_type: 'totp', status: 'verified' }])
  render(<MfaStepUp />)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /로그아웃/ }))
  })
  const { auth } = (createClient as jest.Mock).mock.results.at(-1)!.value
  expect(auth.signOut).toHaveBeenCalled()
  expect(replace).toHaveBeenCalledWith('/login')
})

describe('mode=replace', () => {
  const OLD = { id: 'f-old', factor_type: 'totp', status: 'verified' }
  beforeEach(() => {
    searchStr = 'mode=replace&next=/settings/account'
  })

  async function enterCode() {
    await screen.findByAltText('TOTP QR 코드')
    fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '확인' }))
    })
  }

  test('새 factor 등록 → 검증 → 기존 factor 해제 순서, replace 감사 로그 후 next 로', async () => {
    const mfa = mockAuth([OLD], FRESH_AAL)
    render(<MfaStepUp />)
    await enterCode()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/account'))
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-new', code: '123456' })
    expect(mfa.unenroll).toHaveBeenCalledTimes(1)
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-old' })
    const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]
    expect(order(mfa.enroll)).toBeLessThan(order(mfa.challengeAndVerify))
    expect(order(mfa.challengeAndVerify)).toBeLessThan(order(mfa.unenroll))
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.action).toBe('account.mfa.replace')
  })

  test('검증 실패면 기존 factor 를 해제하지 않고 머문다', async () => {
    const mfa = mockAuth([OLD], FRESH_AAL)
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'bad' } })
    render(<MfaStepUp />)
    await enterCode()
    expect(await screen.findByRole('alert')).toHaveTextContent('인증 코드가 올바르지 않습니다.')
    expect(mfa.unenroll).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('취소하면 새 factor 만 지우고 기존 factor 는 유지', async () => {
    const mfa = mockAuth([OLD], FRESH_AAL)
    render(<MfaStepUp />)
    await screen.findByAltText('TOTP QR 코드')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /취소/ }))
    })
    expect(mfa.unenroll).toHaveBeenCalledTimes(1)
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-new' })
    expect(replace).toHaveBeenCalledWith('/settings/account')
  })

  test('기존 factor 해제가 aal 부족으로 실패하면 안내하고 이동하지 않는다', async () => {
    const mfa = mockAuth([OLD], FRESH_AAL)
    mfa.unenroll.mockResolvedValue({ data: null, error: { code: 'insufficient_aal' } })
    render(<MfaStepUp />)
    await enterCode()
    expect(await screen.findByRole('alert')).toHaveTextContent('2단계 인증이 필요합니다')
    expect(replace).not.toHaveBeenCalled()
  })

  test('aal2 가 오래됐으면 등록 없이 일반 단계 인증으로, 안내를 보여준다', async () => {
    const mfa = mockAuth([OLD], AAL1)
    render(<MfaStepUp />)
    expect(await screen.findByText(/먼저 현재 기기로 인증하세요/)).toBeTruthy()
    expect(mfa.enroll).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value: '123456' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '확인' }))
    })
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-old', code: '123456' })
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })
})
