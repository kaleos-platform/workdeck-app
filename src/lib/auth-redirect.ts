export const DEFAULT_AUTH_REDIRECT_PATH = '/my-deck'

// 외부 도메인 이동을 막기 위해 앱 내부 절대 경로만 허용한다.
export function sanitizeRedirectPath(value?: string | null): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  // 브라우저 URL 파서는 백슬래시를 '/' 로 보고 탭·개행을 지운다 — '/\evil.com', '/<TAB>/evil.com' 이 외부로 풀린다.
  if (/[\\\x00-\x1f\x7f]/.test(trimmed)) return null

  // 최종 방어: 실제로 파싱해 같은 오리진인지 확인한다.
  const base = 'http://redirect.invalid'
  let url: URL
  try {
    url = new URL(trimmed, base)
  } catch {
    return null
  }
  if (url.origin !== base) return null

  return url.pathname + url.search + url.hash
}

export function resolveRedirectPath(
  value?: string | null,
  fallback = DEFAULT_AUTH_REDIRECT_PATH
): string {
  return sanitizeRedirectPath(value) ?? fallback
}
