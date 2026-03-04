export const DEFAULT_AUTH_REDIRECT_PATH = '/my-deck'

// 외부 도메인 이동을 막기 위해 앱 내부 절대 경로만 허용한다.
export function sanitizeRedirectPath(value?: string | null): string | null {
  if (!value) return null

  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null

  return trimmed
}

export function resolveRedirectPath(
  value?: string | null,
  fallback = DEFAULT_AUTH_REDIRECT_PATH
): string {
  return sanitizeRedirectPath(value) ?? fallback
}
