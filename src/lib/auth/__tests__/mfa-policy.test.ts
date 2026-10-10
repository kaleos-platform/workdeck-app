/** @jest-environment node */
import { isMfaFresh, MFA_REMEMBER_SEC, mfaStepUpPath } from '../mfa-policy'

const NOW = 1_800_000_000

test('aal1 → 미충족', () => {
  expect(isMfaFresh({ currentLevel: 'aal1', currentAuthenticationMethods: [] }, NOW)).toBe(false)
})

test('aal2 + 최근 TOTP → 충족', () => {
  expect(
    isMfaFresh(
      {
        currentLevel: 'aal2',
        currentAuthenticationMethods: [
          { method: 'totp', timestamp: NOW - 60 },
          { method: 'password', timestamp: NOW - 120 },
        ],
      },
      NOW
    )
  ).toBe(true)
})

test('TOTP 가 30일을 넘으면 다시 요구(기기 기억 30일)', () => {
  const aal = {
    currentLevel: 'aal2',
    currentAuthenticationMethods: [{ method: 'totp', timestamp: NOW - MFA_REMEMBER_SEC - 1 }],
  }
  expect(isMfaFresh(aal, NOW)).toBe(false)
  expect(
    isMfaFresh(
      {
        ...aal,
        currentAuthenticationMethods: [{ method: 'totp', timestamp: NOW - MFA_REMEMBER_SEC }],
      },
      NOW
    )
  ).toBe(true)
})

test('aal2 인데 TOTP 기록이 없거나 문자열 형태뿐이면 미충족', () => {
  expect(isMfaFresh({ currentLevel: 'aal2', currentAuthenticationMethods: ['totp'] }, NOW)).toBe(
    false
  )
})

test('단계 인증 경로는 next 를 인코딩한다', () => {
  expect(mfaStepUpPath('/settings/integrations?tab=a')).toBe(
    '/auth/mfa?next=%2Fsettings%2Fintegrations%3Ftab%3Da'
  )
})
