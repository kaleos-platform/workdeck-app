import crypto from 'node:crypto'

// ─── UTM 빌더 (D7) ─────────────────────────────────────────────────────────
// utm_source   = channel.platformSlug
// utm_medium   = channel.kind ('blog' | 'social')
// utm_campaign = deployment.slug (사용자 정의 가능, 기본은 contentId)
// kebab-case 정규화.

export function normalizeKebab(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/_/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

export interface UtmParams {
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
}

export function buildTargetUrl(originalUrl: string, params: UtmParams): string {
  const url = new URL(originalUrl)
  if (params.utmSource) url.searchParams.set('utm_source', normalizeKebab(params.utmSource))
  if (params.utmMedium) url.searchParams.set('utm_medium', normalizeKebab(params.utmMedium))
  if (params.utmCampaign) url.searchParams.set('utm_campaign', normalizeKebab(params.utmCampaign))
  if (params.utmContent) url.searchParams.set('utm_content', normalizeKebab(params.utmContent))
  if (params.utmTerm) url.searchParams.set('utm_term', normalizeKebab(params.utmTerm))
  return url.toString()
}

// 채널 + deployment 메타에서 UTM 기본값 생성.
export function deriveUtmDefaults(input: {
  channelPlatformSlug: string
  channelKind: 'BLOG' | 'SOCIAL'
  campaignSlug?: string | null
  contentTitle?: string | null
}): Required<UtmParams> {
  return {
    utmSource: normalizeKebab(input.channelPlatformSlug),
    utmMedium: input.channelKind.toLowerCase(),
    utmCampaign: normalizeKebab(input.campaignSlug ?? input.contentTitle ?? '') || 'untagged',
    utmContent: null,
    utmTerm: null,
  }
}

// ─── short slug ─────────────────────────────────────────────────────────────
// /c/{slug} 리다이렉트용 — base62 8자. 충돌 가능성은 62^8 ≈ 2.18e14 로 PoC 수준에서 무시 가능.

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateShortSlug(length = 8): string {
  const bytes = crypto.randomBytes(length)
  const out: string[] = []
  for (let i = 0; i < length; i++) {
    out.push(SLUG_CHARS[bytes[i] % SLUG_CHARS.length])
  }
  return out.join('')
}

// ─── IP 익명화 ─────────────────────────────────────────────────────────────

export function hashIp(ip: string, salt = process.env.CLICK_EVENT_SALT ?? 'sc-salt'): string {
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}
