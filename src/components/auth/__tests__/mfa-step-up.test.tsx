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
  const OLD = { id: 'f-old', factor_type: 'totp', status: 'verified', created_at: '2026-01-01' }
  const NEW_VERIFIED = { id: 'f-new', factor_type: 'totp', status: 'verified' }
  const RECENT_AAL = {
    ...FRESH_AAL,
    currentAuthenticationMethods: [{ method: 'totp', timestamp: NOW - 60 }],
  }
  beforeEach(() => {
    searchStr = 'mode=replace&next=/settings/account'
  })

  // 마운트 때는 기존 factor 만, 해제 직전 재확인 때는 새 factor 가 verified 로 보인다.
  function mockReplace(aal: object = RECENT_AAL) {
    const mfa = mockAuth([OLD], aal)
    mfa.listFactors
      .mockResolvedValueOnce({ data: { all: [OLD] }, error: null })
      .mockResolvedValue({ data: { all: [OLD, NEW_VERIFIED] }, error: null })
    return mfa
  }

  async function submit(value = '123456') {
    fireEvent.change(screen.getByLabelText('인증 코드'), { target: { value } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '확인' }))
    })
  }
  async function enterNewCode() {
    await screen.findByAltText('TOTP QR 코드')
    await submit()
  }

  test('최근 5분 내 TOTP 면 재확인 생략: 등록 → 검증 → 재확인 → 기존 해제 순서, replace 감사', async () => {
    const mfa = mockReplace()
    render(<MfaStepUp />)
    await enterNewCode()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/account'))
    expect(mfa.challengeAndVerify).toHaveBeenCalledTimes(1)
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-new', code: '123456' })
    expect(mfa.unenroll).toHaveBeenCalledTimes(1)
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-old' })
    const order = (m: jest.Mock, n = 0) => m.mock.invocationCallOrder[n]
    expect(order(mfa.enroll)).toBeLessThan(order(mfa.challengeAndVerify))
    expect(order(mfa.challengeAndVerify)).toBeLessThan(order(mfa.listFactors, 1))
    expect(order(mfa.listFactors, 1)).toBeLessThan(order(mfa.unenroll))
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.action).toBe('account.mfa.replace')
  })

  test('5분 넘었으면 현재 코드 확인 전에는 등록하지 않는다', async () => {
    const mfa = mockReplace(FRESH_AAL)
    render(<MfaStepUp />)
    expect(await screen.findByText(/현재 인증 앱 코드 확인/)).toBeTruthy()
    expect(mfa.enroll).not.toHaveBeenCalled()
    expect(screen.queryByAltText('TOTP QR 코드')).toBeNull()
  })

  test('현재 코드가 틀리면 등록하지 않고 머문다', async () => {
    const mfa = mockReplace(FRESH_AAL)
    mfa.challengeAndVerify.mockResolvedValueOnce({ data: null, error: { message: 'bad' } })
    render(<MfaStepUp />)
    await screen.findByText(/현재 인증 앱 코드 확인/)
    await submit()
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-old', code: '123456' })
    expect(mfa.enroll).not.toHaveBeenCalled()
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })

  test('현재 코드 확인 후 새 기기 등록·검증으로 진행한다', async () => {
    const mfa = mockReplace(FRESH_AAL)
    render(<MfaStepUp />)
    await screen.findByText(/현재 인증 앱 코드 확인/)
    await submit('111111')
    expect(mfa.challengeAndVerify).toHaveBeenNthCalledWith(1, { factorId: 'f-old', code: '111111' })
    await enterNewCode()
    expect(mfa.challengeAndVerify).toHaveBeenNthCalledWith(2, { factorId: 'f-new', code: '123456' })
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/account'))
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-old' })
  })

  test('현재 코드 확인 후 등록이 실패하면 재확인 단계에 머물고 기존 factor 를 지우지 않는다', async () => {
    const mfa = mockReplace(FRESH_AAL)
    mfa.enroll.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    render(<MfaStepUp />)
    await screen.findByText(/현재 인증 앱 코드 확인/)
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('등록을 시작하지 못했습니다')
    await submit()
    expect(mfa.enroll).toHaveBeenCalledTimes(2)
    expect(mfa.unenroll).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  test('재확인에서 새 factor 가 verified 가 아니면 기존 factor 를 지우지 않는다', async () => {
    const mfa = mockReplace()
    mfa.listFactors
      .mockReset()
      .mockResolvedValueOnce({ data: { all: [OLD] }, error: null })
      .mockResolvedValue({
        data: { all: [OLD, { ...NEW_VERIFIED, status: 'unverified' }] },
        error: null,
      })
    render(<MfaStepUp />)
    await enterNewCode()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '새 기기 확인에 실패했습니다. 다시 시도하세요.'
    )
    expect(mfa.unenroll).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  test('새 코드 검증 실패면 기존 factor 를 해제하지 않고 머문다', async () => {
    const mfa = mockReplace()
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'bad' } })
    render(<MfaStepUp />)
    await enterNewCode()
    expect(await screen.findByRole('alert')).toHaveTextContent('인증 코드가 올바르지 않습니다.')
    expect(mfa.unenroll).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('취소하면 새 factor 만 지우고 기존 factor 는 유지', async () => {
    const mfa = mockReplace()
    render(<MfaStepUp />)
    await screen.findByAltText('TOTP QR 코드')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /취소/ }))
    })
    expect(mfa.unenroll).toHaveBeenCalledTimes(1)
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-new' })
    expect(replace).toHaveBeenCalledWith('/settings/account')
  })

  test('재확인 단계에서 취소하면 아무 factor 도 지우지 않는다', async () => {
    const mfa = mockReplace(FRESH_AAL)
    render(<MfaStepUp />)
    await screen.findByText(/현재 인증 앱 코드 확인/)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /취소/ }))
    })
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })

  test('기존 factor 해제가 aal 부족으로 실패하면 안내하고 이동하지 않는다', async () => {
    const mfa = mockReplace()
    mfa.unenroll.mockResolvedValue({ data: null, error: { code: 'insufficient_aal' } })
    render(<MfaStepUp />)
    await enterNewCode()
    expect(await screen.findByRole('alert')).toHaveTextContent('2단계 인증이 필요합니다')
    expect(replace).not.toHaveBeenCalled()
  })

  test('기존 factor 가 이미 없으면(not found) 성공으로 보고 진행한다', async () => {
    const mfa = mockReplace()
    mfa.unenroll.mockResolvedValue({ data: null, error: { code: 'mfa_factor_not_found' } })
    render(<MfaStepUp />)
    await enterNewCode()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/account'))
  })

  test('aal2 가 오래됐으면 등록 없이 일반 단계 인증으로, 안내를 보여준다', async () => {
    const mfa = mockAuth([OLD], AAL1)
    render(<MfaStepUp />)
    expect(await screen.findByText(/먼저 현재 기기로 인증하세요/)).toBeTruthy()
    expect(mfa.enroll).not.toHaveBeenCalled()
    await submit()
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f-old', code: '123456' })
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })
})

test('마운트 정리: 10분 이내 unverified 는 남기고 오래된 unverified 만 지운다', async () => {
  const recent = new Date(Date.now() - 60_000).toISOString()
  const mfa = mockAuth([
    { id: 'u-old', factor_type: 'totp', status: 'unverified', created_at: '2026-01-01T00:00:00Z' },
    { id: 'u-new', factor_type: 'totp', status: 'unverified', created_at: recent },
    { id: 'f1', factor_type: 'totp', status: 'verified', created_at: '2026-01-01T00:00:00Z' },
  ] as never)
  render(<MfaStepUp />)
  await waitFor(() => expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'u-old' }))
  expect(mfa.unenroll).toHaveBeenCalledTimes(1)
})
