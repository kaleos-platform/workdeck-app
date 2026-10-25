import { fireEvent, render, screen } from '@testing-library/react'
import { createClient } from '@/lib/supabase/client'
import { MfaCard } from '../mfa-card'

jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn() }))

const NOW = Math.floor(Date.now() / 1000)
const STEP_UP = '/auth/mfa?next=%2Fsettings%2Faccount'
const VERIFIED = [{ id: 'f1', factor_type: 'totp', status: 'verified' }]

function mockAuth(factors: object[], aal: object) {
  ;(createClient as jest.Mock).mockReturnValue({
    auth: {
      mfa: {
        listFactors: jest.fn().mockResolvedValue({ data: { all: factors }, error: null }),
        getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({ data: aal, error: null }),
      },
    },
  })
}
const aal2 = (daysAgo: number) => ({
  currentLevel: 'aal2',
  nextLevel: 'aal2',
  currentAuthenticationMethods: [
    { method: 'password', timestamp: NOW },
    { method: 'totp', timestamp: NOW - daysAgo * 86400 },
  ],
})
const AAL1 = {
  currentLevel: 'aal1',
  nextLevel: 'aal2',
  currentAuthenticationMethods: [{ method: 'password', timestamp: NOW }],
}

test('미등록이면 [등록하기]가 단계 인증으로 간다', async () => {
  mockAuth([{ id: 'u', factor_type: 'totp', status: 'unverified' }], AAL1)
  render(<MfaCard />)
  expect(await screen.findByText('미등록')).toBeTruthy()
  expect(screen.getByRole('link', { name: '등록하기' })).toHaveAttribute('href', STEP_UP)
})

test('등록됨·최근 인증이면 경과일과 30일 유지를 보여주고 기기 변경 확인창이 replace 로 간다', async () => {
  mockAuth(VERIFIED, aal2(3))
  render(<MfaCard />)
  expect(await screen.findByText('등록됨')).toBeTruthy()
  expect(screen.getByText('마지막 인증 3일 전 · 30일 동안 유지')).toBeTruthy()
  expect(screen.getByRole('link', { name: '지금 인증' })).toHaveAttribute('href', STEP_UP)
  expect(screen.queryByText('먼저 지금 인증하세요')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '인증 기기 변경' }))
  expect(
    screen.getByText(/현재 인증 앱 코드를 한 번 더 확인.*이전 인증 앱은 더 이상 쓸 수 없/)
  ).toBeTruthy()
  expect(screen.getByRole('link', { name: '계속' })).toHaveAttribute(
    'href',
    `${STEP_UP}&mode=replace`
  )
})

test('인증이 30일을 넘었으면 다시 인증 안내, 기기 변경은 비활성', async () => {
  mockAuth(VERIFIED, aal2(31))
  render(<MfaCard />)
  expect(await screen.findByText('마지막 인증 31일 전 · 다시 인증 필요')).toBeTruthy()
  expect(screen.getByRole('button', { name: '인증 기기 변경' })).toBeDisabled()
  expect(screen.getByText('먼저 지금 인증하세요')).toBeTruthy()
})

test('이 로그인에서 TOTP 인증이 없으면(aal1) 경과일 대신 안내, 기기 변경 비활성', async () => {
  mockAuth(VERIFIED, AAL1)
  render(<MfaCard />)
  expect(await screen.findByText('이 로그인에서는 아직 인증하지 않았습니다')).toBeTruthy()
  expect(screen.getByRole('button', { name: '인증 기기 변경' })).toBeDisabled()
})
