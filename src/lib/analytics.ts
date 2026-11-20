// GA4 이벤트 전송 단일 진입점. gtag 가 없거나(미설정·서버) 대시보드·어드민·설정 경로면 아무것도 보내지 않는다.
// page_location·page_referrer 는 여기서 직접 정규화해 URL 의 개인정보·내부 식별자가 새지 않게 한다.

type GtagParams = Record<string, string | number | boolean>

declare global {
  interface Window {
    gtag?: {
      (command: 'event', name: string, params: GtagParams): void
      (command: 'set', params: GtagParams): void
    }
  }
}

const ALLOWED_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const BILLING_SETTINGS_PATH = '/settings/billing'

function underPath(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** 측정 허용 경로인지 — /d/*, /admin, /settings 는 막고 결제 설정만 연다. */
export function isTrackablePath(pathname: string): boolean {
  if (underPath(pathname, '/d') || underPath(pathname, '/admin')) return false
  if (underPath(pathname, '/settings')) return pathname.replace(/\/$/, '') === BILLING_SETTINGS_PATH
  return true
}

/** 오리진 + pathname + 허용 utm 5종만(값 100자 제한, '@' 포함 값 제거). */
export function normalizePageLocation(origin: string, pathname: string, search: string): string {
  const source = new URLSearchParams(search)
  const kept = new URLSearchParams()
  for (const key of ALLOWED_UTM) {
    const value = source.get(key)?.trim().slice(0, 100)
    if (value && !value.includes('@')) kept.set(key, value)
  }
  const query = kept.toString()
  return `${origin}${pathname}${query ? `?${query}` : ''}`
}

/** 같은 사이트(workdeck.work·하위 도메인·현재 오리진) referrer 는 오리진+pathname, 외부는 오리진만, 없으면 빈 문자열. */
export function normalizeReferrer(referrer: string, currentOrigin: string): string {
  if (!referrer) return ''
  try {
    const url = new URL(referrer)
    const sameSite =
      url.origin === currentOrigin ||
      url.hostname === 'workdeck.work' ||
      url.hostname.endsWith('.workdeck.work')
    // 같은 사이트라도 /d·/admin·/settings 경로는 내부 ID 가 담기므로 오리진만 남긴다
    return sameSite && isTrackablePath(url.pathname) ? `${url.origin}${url.pathname}` : url.origin
  } catch {
    return ''
  }
}

function pageContext() {
  const { origin, pathname, search } = window.location
  return {
    page_location: normalizePageLocation(origin, pathname, search),
    page_referrer: normalizeReferrer(document.referrer, origin),
  }
}

/**
 * 자동 이벤트(session_start·user_engagement 등)도 정규화된 URL 을 쓰도록 gtag 전역 값에 고정한다.
 * /d/* 등으로 SPA 이동한 뒤에는 호출되지 않으므로 마지막 허용 화면의 정규화 URL 이 남는다(원본 URL 미노출).
 */
export function syncPageContext() {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  // 측정 제외 경로(예: /d/[deckKey]/login 직접 진입)에서도 gtag 가 로드되면 자동 이벤트가 원본 URL 을 쓰지 않게 가린 값을 고정한다
  if (!isTrackablePath(window.location.pathname)) {
    window.gtag('set', { page_location: window.location.origin, page_referrer: '' })
    return
  }
  window.gtag('set', pageContext())
}

export function track(
  name: string,
  params: Record<string, string | number | boolean | undefined> = {}
) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  if (!isTrackablePath(window.location.pathname)) return
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined)
  ) as GtagParams
  window.gtag('event', name, { ...clean, ...pageContext() })
}
