import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createClient } from '@/lib/supabase/client'
import { MfaStepUp } from '../mfa-step-up'

const replace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams('next=/admin'),
}))
jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn() }))

// Supabase enroll() 응답 형태 — qr_code 는 이미 data URI 다.
const QR = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>'

function mockAuth(factors: Array<{ id: string; factor_type: string; status: string }>) {
  const mfa = {
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
