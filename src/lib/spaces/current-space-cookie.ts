// proxy.ts(edge)에서도 쓰는 순수 상수 — server-only·prisma 의존 금지.
export const CURRENT_SPACE_COOKIE = 'wd_space'
// 화면이 열릴 때의 Space — 클라이언트 fetch 가 실어 보내고 API 가 쿠키 Space 와 대조한다.
export const SPACE_HEADER = 'x-wd-space'
export const CURRENT_SPACE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: true,
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
}
