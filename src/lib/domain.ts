const DEFAULT_APP_ORIGIN = 'https://app.workdeck.work'
const DEFAULT_MARKETING_ORIGIN = 'https://workdeck.work'

const APP_HOST = 'app.workdeck.work'
const MARKETING_HOSTS = new Set(['workdeck.work', 'www.workdeck.work'])

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

export function getAppOrigin(): string {
  return stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_ORIGIN)
}

export function getMarketingOrigin(): string {
  return stripTrailingSlash(process.env.NEXT_PUBLIC_MARKETING_URL ?? DEFAULT_MARKETING_ORIGIN)
}

export function buildAppUrl(path: string): string {
  return `${getAppOrigin()}${normalizePath(path)}`
}

export function buildMarketingUrl(path: string): string {
  return `${getMarketingOrigin()}${normalizePath(path)}`
}

export function normalizeHost(host?: string | null): string {
  if (!host) return ''
  return host.trim().toLowerCase().split(':')[0] ?? ''
}

export function isAppHost(host?: string | null): boolean {
  return normalizeHost(host) === APP_HOST
}

export function isMarketingHost(host?: string | null): boolean {
  return MARKETING_HOSTS.has(normalizeHost(host))
}
