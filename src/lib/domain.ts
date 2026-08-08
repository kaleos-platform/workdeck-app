const DEFAULT_APP_ORIGIN = 'https://app.workdeck.work'
const DEFAULT_MARKETING_ORIGIN = 'https://workdeck.work'
const DEFAULT_ADMIN_ORIGIN = 'https://admin.workdeck.work'

const APP_HOST = 'app.workdeck.work'
const MARKETING_HOSTS = new Set(['workdeck.work', 'www.workdeck.work'])
const ADMIN_HOST = 'admin.workdeck.work'

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Preview 배포 시 VERCEL_URL로 자동 감지.
 * 운영 배포 시 NEXT_PUBLIC_APP_URL 또는 DEFAULT_APP_ORIGIN 사용.
 * 개발(NODE_ENV=development)은 기본 localhost:3000 사용.
 */
export function getAppOrigin(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL)
  }
  if (process.env.NEXT_PUBLIC_VERCEL_URL && process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production') {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  }
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }
  return DEFAULT_APP_ORIGIN
}

export function getMarketingOrigin(): string {
  if (process.env.NEXT_PUBLIC_MARKETING_URL) {
    return stripTrailingSlash(process.env.NEXT_PUBLIC_MARKETING_URL)
  }
  if (process.env.NEXT_PUBLIC_VERCEL_URL && process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production') {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  }
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }
  return DEFAULT_MARKETING_ORIGIN
}

/**
 * 운영자 웹 어드민 오리진. 운영 배포 시 NEXT_PUBLIC_ADMIN_URL 또는 DEFAULT_ADMIN_ORIGIN 사용.
 * dev/preview는 app 오리진과 동일(단일 호스트, 경로 기반 접근).
 */
export function getAdminOrigin(): string {
  if (process.env.NEXT_PUBLIC_ADMIN_URL) {
    return stripTrailingSlash(process.env.NEXT_PUBLIC_ADMIN_URL)
  }
  if (process.env.NEXT_PUBLIC_VERCEL_URL && process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production') {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
  }
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }
  return DEFAULT_ADMIN_ORIGIN
}

export function buildAppUrl(path: string): string {
  return `${getAppOrigin()}${normalizePath(path)}`
}

export function buildMarketingUrl(path: string): string {
  return `${getMarketingOrigin()}${normalizePath(path)}`
}

export function buildAdminUrl(path: string): string {
  return `${getAdminOrigin()}${normalizePath(path)}`
}

export function normalizeHost(host?: string | null): string {
  if (!host) return ''
  return host.trim().toLowerCase().split(':')[0] ?? ''
}

export function isAppHost(host?: string | null): boolean {
  const normalized = normalizeHost(host)
  if (normalized === APP_HOST) return true
  // Preview/Vercel 배포 호스트도 앱 도메인으로 취급
  if (normalized.includes('vercel.app')) return true
  if (normalized === 'localhost') return true
  return false
}

export function isMarketingHost(host?: string | null): boolean {
  return MARKETING_HOSTS.has(normalizeHost(host))
}

export function isAdminHost(host?: string | null): boolean {
  const normalized = normalizeHost(host)
  if (normalized === ADMIN_HOST) return true
  const configuredAdminHost = normalizeHost(
    process.env.NEXT_PUBLIC_ADMIN_URL ? new URL(process.env.NEXT_PUBLIC_ADMIN_URL).host : null
  )
  if (configuredAdminHost && normalized === configuredAdminHost) return true
  return false
}
