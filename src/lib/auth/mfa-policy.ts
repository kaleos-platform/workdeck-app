/**
 * MFA 판정(순수). Supabase 에는 "이 기기 기억" 기능이 없다 — aal2 는 세션 속성이고 refresh 로 유지된다.
 * 그래서 "기기 기억 30일"은 세션 기준으로 구현한다: aal2 이고 마지막 TOTP 인증(amr timestamp, 초)이
 * 30일 이내면 통과. 로그아웃·다른 기기는 다시 인증한다.
 */
export const MFA_REMEMBER_SEC = 30 * 24 * 60 * 60

type AmrEntry = { method: string; timestamp: number } | string

export function isMfaFresh(
  aal: { currentLevel: string | null; currentAuthenticationMethods: ReadonlyArray<AmrEntry> },
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (aal.currentLevel !== 'aal2') return false
  const totp = aal.currentAuthenticationMethods.find(
    (m): m is { method: string; timestamp: number } => typeof m === 'object' && m.method === 'totp'
  )
  return !!totp && nowSec - totp.timestamp <= MFA_REMEMBER_SEC
}

export function mfaStepUpPath(next: string): string {
  return `/auth/mfa?next=${encodeURIComponent(next)}`
}
