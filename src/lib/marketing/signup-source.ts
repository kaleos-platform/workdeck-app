/**
 * 가입 유입 경로(first-touch utm) — proxy.ts(Edge)·가입 폼·서버가 공유한다.
 * 주의: 어떤 모듈도 import 하지 말 것(Edge 번들 호환).
 */

export const SIGNUP_SOURCE_COOKIE = 'wd_src'
export const SIGNUP_SOURCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const MAX_LEN = 100

export type SignupSource = Partial<Record<(typeof UTM_KEYS)[number] | 'landing' | 'at', string>>

/** 임의 입력(쿠키 JSON·user_metadata)을 짧은 문자열 객체로 정리한다. utm_source 없으면 null. */
export function sanitizeSignupSource(input: unknown): SignupSource | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const out: SignupSource = {}
  for (const key of [...UTM_KEYS, 'landing', 'at'] as const) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, MAX_LEN)
  }
  return out.utm_source ? out : null
}

/** URL 쿼리에서 utm 을 뽑는다. utm_source 가 없으면 null. */
export function signupSourceFromSearch(
  searchParams: URLSearchParams,
  landing?: string
): SignupSource | null {
  const raw: Record<string, string> = {}
  for (const key of UTM_KEYS) {
    const v = searchParams.get(key)
    if (v) raw[key] = v
  }
  if (landing) raw.landing = landing
  raw.at = new Date().toISOString()
  return sanitizeSignupSource(raw)
}

/** 쿠키 값(JSON 문자열)을 파싱한다. 깨진 값은 null. */
export function parseSignupSourceCookie(value?: string | null): SignupSource | null {
  if (!value) return null
  try {
    return sanitizeSignupSource(JSON.parse(value))
  } catch {
    return null
  }
}

/** marketing→app 이동에서도 쿠키가 유지되도록 workdeck.work 계열 호스트면 상위 도메인을 쓴다. */
export function signupSourceCookieDomain(host: string): string | undefined {
  return host === 'workdeck.work' || host.endsWith('.workdeck.work') ? '.workdeck.work' : undefined
}
