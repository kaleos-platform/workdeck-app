/**
 * 운영사 GA4 조회 — 향상된 측정 설정(Admin API v1alpha)·웹 스트림 측정 ID(v1beta)·퍼널 요약(Data API v1beta).
 * 응답 본문·토큰은 어디에도 기록하지 않는다. 오류는 GoogleOAuthError(단계·HTTP 상태·허용 코드)만 던진다.
 */
import 'server-only'
import {
  GoogleOAuthError,
  oauthErrorCode,
  oauthHttp,
  refreshGoogleAccessToken,
} from '@/lib/agent/integrations/google-marketing'
import { readPlatformGoogle, type PlatformRow } from '@/lib/admin/platform-google'

const ADMIN_BASE = 'https://analyticsadmin.googleapis.com'
const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta'

// EnhancedMeasurementSettings 의 boolean 필드(v1alpha 문서 기준). 없거나 boolean 이 아니면 null(알 수 없음).
export const ENHANCED_KEYS = [
  'streamEnabled',
  'pageChangesEnabled',
  'scrollsEnabled',
  'outboundClicksEnabled',
  'siteSearchEnabled',
  'formInteractionsEnabled',
  'videoEngagementEnabled',
  'fileDownloadsEnabled',
] as const
export type EnhancedKey = (typeof ENHANCED_KEYS)[number]
export type EnhancedSettings = Record<EnhancedKey, boolean | null>

export const FUNNEL_EVENTS = [
  'page_view',
  'cta_click',
  'generate_lead',
  'sign_up',
  'trial_start',
  'subscribe',
] as const
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number]

export interface SourceRow {
  source: string
  medium: string
  signUp: number
  subscribe: number
}
export interface FunnelSummary {
  days: number
  events: Record<FunnelEvent, number>
  sources: SourceRow[]
}

export interface Ga4Bundle {
  measurementId: string | null
  enhanced: EnhancedSettings | null
  funnel: FunnelSummary | null
  /** 단계별 실패 한 줄(상태·허용 코드만) */
  errors: string[]
}

async function getJson(stage: string, token: string, url: string, init: RequestInit = {}) {
  const res = await oauthHttp(stage, url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  if (!res.ok) throw new GoogleOAuthError(stage, await oauthErrorCode(res), res.status)
  const body = await res.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new GoogleOAuthError(stage, 'invalid_response')
  return body as Record<string, unknown>
}

/** 웹 스트림 조회 — 접근 권한 확인 겸 측정 ID(G-…) 반환. */
export async function fetchMeasurementId(
  token: string,
  propertyId: string,
  streamId: string
): Promise<string | null> {
  const body = await getJson(
    '스트림 조회',
    token,
    `${ADMIN_BASE}/v1beta/properties/${propertyId}/dataStreams/${streamId}`
  )
  const id = (body.webStreamData as { measurementId?: unknown } | undefined)?.measurementId
  return typeof id === 'string' ? id : null
}

export async function fetchEnhancedMeasurement(
  token: string,
  propertyId: string,
  streamId: string
): Promise<EnhancedSettings> {
  const body = await getJson(
    '향상된 측정 조회',
    token,
    `${ADMIN_BASE}/v1alpha/properties/${propertyId}/dataStreams/${streamId}/enhancedMeasurementSettings`
  )
  return Object.fromEntries(
    ENHANCED_KEYS.map((k) => [k, typeof body[k] === 'boolean' ? body[k] : null])
  ) as EnhancedSettings
}

type ReportRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }
const rowsOf = (body: Record<string, unknown>): ReportRow[] =>
  Array.isArray(body.rows) ? (body.rows as ReportRow[]) : []
const num = (v: string | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function fetchFunnelSummary(
  token: string,
  propertyId: string,
  days = 7
): Promise<FunnelSummary> {
  const url = `${DATA_BASE}/properties/${propertyId}:runReport`
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }]
  const inList = (values: readonly string[]) => ({
    filter: { fieldName: 'eventName', inListFilter: { values: [...values] } },
  })
  const [totals, bySource] = await Promise.all([
    getJson('퍼널 조회', token, url, {
      method: 'POST',
      body: JSON.stringify({
        dateRanges,
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: inList(FUNNEL_EVENTS),
      }),
    }),
    getJson('유입별 퍼널 조회', token, url, {
      method: 'POST',
      body: JSON.stringify({
        dateRanges,
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: inList(['sign_up', 'subscribe']),
        limit: 200,
      }),
    }),
  ])

  const events = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0])) as Record<FunnelEvent, number>
  for (const r of rowsOf(totals)) {
    const name = r.dimensionValues?.[0]?.value as FunnelEvent | undefined
    if (name && name in events) events[name] += num(r.metricValues?.[0]?.value)
  }

  const bucket = new Map<string, SourceRow>()
  for (const r of rowsOf(bySource)) {
    const [source = '(unknown)', medium = '(unknown)', name] = (r.dimensionValues ?? []).map(
      (d) => d.value
    )
    const key = `${source}\u0000${medium}`
    const row = bucket.get(key) ?? { source, medium, signUp: 0, subscribe: 0 }
    const n = num(r.metricValues?.[0]?.value)
    if (name === 'sign_up') row.signUp += n
    if (name === 'subscribe') row.subscribe += n
    bucket.set(key, row)
  }
  const sources = [...bucket.values()]
    .sort((a, b) => b.subscribe + b.signUp - (a.subscribe + a.signUp))
    .slice(0, 10)
  return { days, events, sources }
}

const failure = (err: unknown) => (err instanceof GoogleOAuthError ? err.message : '조회 실패')

/** 연결됨 행의 GA4 상태 묶음. 단계마다 독립으로 실패를 모은다. */
export async function loadGa4Bundle(row: PlatformRow): Promise<Ga4Bundle> {
  const bundle: Ga4Bundle = { measurementId: null, enhanced: null, funnel: null, errors: [] }
  let token: string
  try {
    token = await refreshGoogleAccessToken(row.secret)
  } catch (err) {
    bundle.errors.push(failure(err))
    return bundle
  }
  const { propertyId, streamId } = row.config
  const [m, e, f] = await Promise.allSettled([
    fetchMeasurementId(token, propertyId, streamId),
    fetchEnhancedMeasurement(token, propertyId, streamId),
    fetchFunnelSummary(token, propertyId),
  ])
  if (m.status === 'fulfilled') bundle.measurementId = m.value
  else bundle.errors.push(failure(m.reason))
  if (e.status === 'fulfilled') bundle.enhanced = e.value
  else bundle.errors.push(failure(e.reason))
  if (f.status === 'fulfilled') bundle.funnel = f.value
  else bundle.errors.push(failure(f.reason))
  return bundle
}

export interface PlatformGoogleView {
  registered: boolean
  clientId: string
  hasRefreshToken: boolean
  propertyId: string
  streamId: string
  status: PlatformRow['config']['status'] | null
  connectedAt: string | null
  lastError: string | null
  ga4: Ga4Bundle | null
}

/** 화면·GET 라우트 공용 상태. clientSecret·토큰 값은 담지 않는다. */
export async function loadPlatformGoogleView(): Promise<PlatformGoogleView> {
  const row = await readPlatformGoogle()
  if (!row) {
    return {
      registered: false,
      clientId: '',
      hasRefreshToken: false,
      propertyId: '',
      streamId: '',
      status: null,
      connectedAt: null,
      lastError: null,
      ga4: null,
    }
  }
  return {
    registered: true,
    clientId: row.secret.clientId,
    hasRefreshToken: !!row.secret.refreshToken,
    propertyId: row.config.propertyId,
    streamId: row.config.streamId,
    status: row.config.status,
    connectedAt: row.config.connectedAt ?? null,
    lastError: row.lastError,
    ga4: row.config.status === 'connected' ? await loadGa4Bundle(row) : null,
  }
}
