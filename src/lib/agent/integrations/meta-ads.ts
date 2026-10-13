import crypto from 'node:crypto'
import { maskSecrets } from '@/lib/agent/audit'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { loadSpaceCredential, recordCredentialError } from './space-credential'

/**
 * 메타 광고(Marketing API) 클라이언트 — 에밀리 meta-ads-server.mjs 이식.
 * 자격증명은 env 파일이 아니라 Space 암호화 자격증명(provider 'meta-ads')에서 읽는다.
 */
export const PROVIDER = 'meta-ads'
const DEFAULT_GRAPH_VERSION = 'v26.0'

export interface MetaSecret {
  accessToken: string
  appSecret: string
}
// accountCurrencies: 저장 시점에 서버가 Graph로 확인한 광고 계정별 통화(act_… → 'KRW' 등). 입력으로 받지 않는다.
// Meta 예산은 계정 통화의 최소 단위 정수 문자열이고, KRW는 소수 단위가 없어 값이 그대로 원이다.
// 그래서 예산 액션은 KRW로 확인된 계정만 허용한다(assertMetaTarget).
export interface MetaConfig {
  graphVersion?: string
  defaultBrand?: string
  adAccounts: Record<string, string>
  accountCurrencies?: Record<string, string>
}
export interface MetaCred {
  id: string
  secret: MetaSecret
  config: MetaConfig
}

type Params = Record<string, unknown>
interface MetaActionSpec {
  endpoint: (adAccountId: string, p: Params) => string
  // 기존 객체를 고치는 액션 — 이 키의 객체가 Space 광고 계정 소속인지 실행 전에 확인한다.
  objectKey?: string
  // 경로에만 쓰고 본문에서는 빼는 키(원본 actionRequest의 pathParams).
  pathParams?: readonly string[]
}

// 원본 ACTIONS를 그대로 옮긴다(2026-10-12 원본에서 A/B 테스트 adstudy.* 추가).
export const META_ACTIONS = {
  'campaign.create': { endpoint: (a) => `/${a}/campaigns` },
  'campaign.update': { endpoint: (_a, p) => `/${p.campaign_id}`, objectKey: 'campaign_id' },
  'campaign.update_status': { endpoint: (_a, p) => `/${p.campaign_id}`, objectKey: 'campaign_id' },
  'adset.create': { endpoint: (a) => `/${a}/adsets` },
  'adset.update': { endpoint: (_a, p) => `/${p.adset_id}`, objectKey: 'adset_id' },
  'adset.update_status': { endpoint: (_a, p) => `/${p.adset_id}`, objectKey: 'adset_id' },
  'creative.create': { endpoint: (a) => `/${a}/adcreatives` },
  'ad.create': { endpoint: (a) => `/${a}/ads` },
  'ad.update': { endpoint: (_a, p) => `/${p.ad_id}`, objectKey: 'ad_id' },
  'ad.update_status': { endpoint: (_a, p) => `/${p.ad_id}`, objectKey: 'ad_id' },
  // A/B 테스트(split test). business_id·study_id는 경로에만 쓰고 본문으로 보내지 않는다.
  // 소속 확인은 account_id가 아니라 business로 한다(assertActionInAccount).
  'adstudy.create': {
    endpoint: (_a, p) => `/${p.business_id}/ad_studies`,
    pathParams: ['business_id'],
  },
  'adstudy.update': { endpoint: (_a, p) => `/${p.study_id}`, pathParams: ['study_id'] },
} as const satisfies Record<string, MetaActionSpec>

export type MetaActionName = keyof typeof META_ACTIONS

// 예산 파라미터를 실을 수 있는 액션 — metaSpendKrw로 지출 금액을 알려 승인 한도 판정(requiredDecisionRole)에 쓴다.
export const META_BUDGET_ACTIONS: ReadonlySet<MetaActionName> = new Set<MetaActionName>([
  'campaign.create',
  'campaign.update',
  'adset.create',
  'adset.update',
])

/**
 * 승인 한도 판정용 지출 금액(원). daily_budget·lifetime_budget 중 있는 값의 최댓값, 둘 다 없으면 null.
 * KRW 계정 전제: 값이 그대로 원이다(assertMetaTarget이 제안·생성·실행 시점에 KRW로 확인된 계정만 통과시킨다).
 * 값은 변경 후 예산 상한이지 증가분이 아니다. 해석할 수 없는 값(NaN·음수)은 한도를 통과하지 못하도록 MAX_SAFE_INTEGER.
 */
export function metaSpendKrw(params: Params): number | null {
  const vals = ['daily_budget', 'lifetime_budget']
    .map((k) => params[k])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => Number(v))
  if (vals.length === 0) return null
  if (vals.some((v) => !Number.isFinite(v) || v < 0)) return Number.MAX_SAFE_INTEGER
  return Math.max(...vals)
}

export function normalizeAdAccountId(v: string): string {
  return v.startsWith('act_') ? v : `act_${v}`
}

export function resolveAdAccount(config: MetaConfig, brand?: string): string {
  const selected = brand || config.defaultBrand
  if (!selected) throw new ToolUserError('brand가 필요합니다(기본 브랜드 미설정)')
  const id = Object.hasOwn(config.adAccounts ?? {}, selected)
    ? config.adAccounts[selected]
    : undefined
  if (!id) throw new ToolUserError(`알 수 없는 메타 광고 브랜드: ${selected}`)
  return normalizeAdAccountId(id)
}

/**
 * 제안 도구·validateCreate·execute 공통 대상 확인. 광고 계정은 payload가 아니라 현재 Space config가 정한다.
 * - payload의 adAccountId가 있으면 현재 매핑과 같아야 한다(세션 POST 우회·매핑 변경 뒤 기존 제안 차단).
 * - 예산 액션은 그 계정의 확인된 통화가 KRW여야 한다(미확인 포함 거부).
 */
export function assertMetaTarget(
  config: MetaConfig,
  input: { brand?: string; action: MetaActionName; adAccountId?: string }
): string {
  const resolved = resolveAdAccount(config, input.brand)
  if (input.adAccountId !== undefined && input.adAccountId !== resolved) {
    throw new ToolUserError(
      '광고 계정 매핑이 바뀌었거나 이 Space에 등록되지 않은 계정입니다. 다시 제안하세요'
    )
  }
  if (META_BUDGET_ACTIONS.has(input.action)) {
    const currency = config.accountCurrencies?.[resolved]
    if (currency !== 'KRW') {
      throw new ToolUserError(
        `KRW로 확인된 광고 계정만 예산 변경을 제안할 수 있습니다(확인된 통화: ${currency ?? '미확인'})`
      )
    }
  }
  return resolved
}

const NUMERIC_ID = /^\d+$/

/**
 * 액션 이름·params 형태 확인. 경로에 들어가는 id(objectKey·pathParams)는 숫자만 허용한다 —
 * `act_…`나 `/`가 섞이면 다른 객체(광고 계정 자체 등)로 POST가 가기 때문이다.
 */
export function validateMetaAction(input: { action: unknown; params: unknown }): {
  action: MetaActionName
  params: Params
} {
  if (typeof input.action !== 'string' || !Object.hasOwn(META_ACTIONS, input.action)) {
    throw new ToolUserError(`지원하지 않는 메타 광고 액션: ${String(input.action)}`)
  }
  if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) {
    throw new ToolUserError('params는 객체여야 합니다')
  }
  const action = input.action as MetaActionName
  const params = input.params as Params
  const spec: MetaActionSpec = META_ACTIONS[action]
  for (const key of [...(spec.objectKey ? [spec.objectKey] : []), ...(spec.pathParams ?? [])]) {
    if (!NUMERIC_ID.test(String(params[key] ?? ''))) {
      throw new ToolUserError(`params.${key}는 숫자 id여야 합니다`)
    }
  }
  return { action, params }
}

/** 실행 요청(원본 actionRequest) — 경로 전용 키는 본문에서 뺀다. */
export function metaActionRequest(
  action: MetaActionName,
  adAccountId: string,
  params: Params
): { endpoint: string; body: Params } {
  const spec: MetaActionSpec = META_ACTIONS[action]
  const body = { ...params }
  for (const key of spec.pathParams ?? []) delete body[key]
  return { endpoint: spec.endpoint(adAccountId, params), body }
}

export function sanitizeMetaResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetaResponse)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] =
      typeof v === 'string' && /[?&](access_token|appsecret_proof)=/i.test(v)
        ? '[redacted]'
        : sanitizeMetaResponse(v)
  }
  return out
}

export async function loadMetaCred(spaceId: string, audit: string[]): Promise<MetaCred> {
  const c = await loadSpaceCredential<MetaSecret>(spaceId, PROVIDER, audit)
  return { id: c.id, secret: c.secret, config: c.config as unknown as MetaConfig }
}

function appSecretProof(s: MetaSecret): string {
  return crypto.createHmac('sha256', s.appSecret).update(s.accessToken).digest('hex')
}

/** Graph API 호출. 토큰은 서버 안에서만 쓰고, 응답의 토큰 포함 URL은 지우고, 오류 문구는 마스킹한다. */
export async function graphRequest(
  cred: Pick<MetaCred, 'secret' | 'config'>,
  method: 'GET' | 'POST',
  endpoint: string,
  params: Params = {}
): Promise<unknown> {
  const url = new URL(
    `https://graph.facebook.com/${cred.config.graphVersion ?? DEFAULT_GRAPH_VERSION}${endpoint}`
  )
  url.searchParams.set('access_token', cred.secret.accessToken)
  url.searchParams.set('appsecret_proof', appSecretProof(cred.secret))
  const encode = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  )
  const init: RequestInit = { method }
  if (method === 'GET') {
    for (const [k, v] of entries) url.searchParams.set(k, encode(v))
  } else {
    init.body = new URLSearchParams(entries.map(([k, v]) => [k, encode(v)]))
  }
  const res = await fetch(url, init)
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!res.ok) {
    throw new ToolUserError(
      maskSecrets(body?.error?.message || `Meta API 요청 실패 (${res.status})`)
    )
  }
  return sanitizeMetaResponse(body)
}

/** 매핑된 광고 계정마다 통화를 Graph로 확인한다(자격증명 저장 시점). 하나라도 실패하면 throw — 저장하지 않는다. */
export async function fetchAdAccountCurrencies(
  secret: MetaSecret,
  config: Pick<MetaConfig, 'graphVersion' | 'adAccounts'>
): Promise<Record<string, string>> {
  const cred = { secret, config: { ...config } }
  const out: Record<string, string> = {}
  for (const account of new Set(Object.values(config.adAccounts).map(normalizeAdAccountId))) {
    const r = (await graphRequest(cred, 'GET', `/${account}`, { fields: 'currency' })) as {
      currency?: string
    }
    if (!r.currency) throw new ToolUserError(`${account}의 통화를 확인하지 못했습니다`)
    out[account] = r.currency
  }
  return out
}

/** 객체(캠페인·광고세트·광고)가 이 Space의 광고 계정에 속하는지 확인한다 — 같은 토큰으로 볼 수 있는 다른 계정 차단. */
export async function assertObjectInAccount(
  cred: MetaCred,
  objectId: string,
  adAccountId: string
): Promise<void> {
  if (objectId === adAccountId) return
  const obj = (await graphRequest(cred, 'GET', `/${encodeURIComponent(objectId)}`, {
    fields: 'account_id',
  })) as { account_id?: string }
  if (!obj.account_id || normalizeAdAccountId(obj.account_id) !== adAccountId) {
    throw new ToolUserError('이 Space의 광고 계정에 속하지 않는 객체입니다')
  }
}

async function businessOf(cred: MetaCred, objectId: string): Promise<string | undefined> {
  const r = (await graphRequest(cred, 'GET', `/${encodeURIComponent(objectId)}`, {
    fields: 'business',
  })) as { business?: { id?: string } }
  return r.business?.id
}

/**
 * 실행 직전 Space 경계 확인(Graph 조회). 원본에는 없는 workdeck 규칙이다.
 * - 기존 객체 수정: 객체의 account_id가 Space 광고 계정이어야 한다.
 * - adstudy: 대상 비즈니스가 광고 계정을 소유한 비즈니스여야 하고, cells의 캠페인·광고세트가 모두 Space 광고 계정 소속이어야 한다.
 */
export async function assertActionInAccount(
  cred: MetaCred,
  action: MetaActionName,
  params: Params,
  adAccountId: string
): Promise<void> {
  const spec: MetaActionSpec = META_ACTIONS[action]
  if (spec.objectKey) await assertObjectInAccount(cred, String(params[spec.objectKey]), adAccountId)
  if (action !== 'adstudy.create' && action !== 'adstudy.update') return

  const accountBusiness = await businessOf(cred, adAccountId)
  const targetBusiness =
    action === 'adstudy.create'
      ? String(params.business_id)
      : await businessOf(cred, String(params.study_id))
  if (!accountBusiness || targetBusiness !== accountBusiness) {
    throw new ToolUserError('이 Space 광고 계정의 비즈니스가 아닙니다')
  }
  if (params.cells === undefined) return
  const cells = typeof params.cells === 'string' ? safeJson(params.cells) : params.cells
  if (!Array.isArray(cells)) throw new ToolUserError('params.cells는 배열이어야 합니다')
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object')
      throw new ToolUserError('params.cells 형식이 올바르지 않습니다')
    for (const key of ['adsets', 'campaigns'] as const) {
      const ids = (cell as Record<string, unknown>)[key]
      if (ids === undefined) continue
      if (!Array.isArray(ids)) throw new ToolUserError(`cells.${key}는 배열이어야 합니다`)
      for (const id of ids) {
        if (!NUMERIC_ID.test(String(id)))
          throw new ToolUserError(`cells.${key}의 id는 숫자여야 합니다`)
        await assertObjectInAccount(cred, String(id), adAccountId)
      }
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

export async function recordMetaError(credId: string, err: unknown): Promise<void> {
  await recordCredentialError(credId, err instanceof Error ? err.message : String(err))
}
