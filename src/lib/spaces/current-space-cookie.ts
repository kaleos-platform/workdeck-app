// proxy.ts(edge)에서도 쓰는 순수 상수 — server-only·prisma 의존 금지.
export const CURRENT_SPACE_COOKIE = 'wd_space'
export const CURRENT_SPACE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: true,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
}
