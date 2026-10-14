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
  // Graph로 보낼 수 있는 params 키(허용 목록, objectKey·pathParams 포함). 그 밖의 키는 제안·생성·실행에서 모두 거부한다.
  keys: readonly string[]
}

// 지출 금액 키 — 예산 액션(META_BUDGET_ACTIONS)에서만 허용하고, metaSpendKrw가 모두 센다.
export const META_MONEY_KEYS = [
  'daily_budget',
  'lifetime_budget',
  'spend_cap',
  'daily_spend_cap',
  'lifetime_spend_cap',
  'bid_amount',
] as const

const CAMPAIGN_FIELDS = [
  'name',
  'status',
  'bid_strategy',
  'start_time',
  'stop_time',
  'special_ad_categories',
  'special_ad_category_country',
]
const ADSET_FIELDS = [
  'name',
  'status',
  'optimization_goal',
  'billing_event',
  'bid_strategy',
  'targeting',
  'start_time',
  'end_time',
]
const AD_FIELDS = ['name', 'status', 'creative', 'tracking_specs', 'conversion_domain']
const STUDY_FIELDS = ['name', 'description', 'start_time', 'end_time', 'cells']

// 원본 ACTIONS를 옮긴다(2026-10-12 원본에서 A/B 테스트 adstudy.* 추가). 키 허용 목록은 workdeck 규칙이다.
// *_status 액션은 id와 status만 받는다. status=ACTIVE(지출 재개)는 금액이 없으므로 ADMIN이 승인할 수 있다 —
// 이미 승인된 예산 범위 안의 재개라 지출 승인으로 보지 않는다는 운영 결정(2026-10-14, 리뷰 I2).
export const META_ACTIONS = {
  'campaign.create': {
    endpoint: (a) => `/${a}/campaigns`,
    keys: [...CAMPAIGN_FIELDS, 'objective', 'buying_type', 'promoted_object', ...META_MONEY_KEYS],
  },
  'campaign.update': {
    endpoint: (_a, p) => `/${p.campaign_id}`,
    objectKey: 'campaign_id',
    keys: ['campaign_id', ...CAMPAIGN_FIELDS, ...META_MONEY_KEYS],
  },
  'campaign.update_status': {
    endpoint: (_a, p) => `/${p.campaign_id}`,
    objectKey: 'campaign_id',
    keys: ['campaign_id', 'status'],
  },
  'adset.create': {
    endpoint: (a) => `/${a}/adsets`,
    keys: [
      'campaign_id',
      ...ADSET_FIELDS,
      'promoted_object',
      'destination_type',
      'attribution_spec',
      ...META_MONEY_KEYS,
    ],
  },
  'adset.update': {
    endpoint: (_a, p) => `/${p.adset_id}`,
    objectKey: 'adset_id',
    keys: ['adset_id', ...ADSET_FIELDS, ...META_MONEY_KEYS],
  },
  'adset.update_status': {
    endpoint: (_a, p) => `/${p.adset_id}`,
    objectKey: 'adset_id',
    keys: ['adset_id', 'status'],
  },
  'creative.create': {
    endpoint: (a) => `/${a}/adcreatives`,
    keys: [
      'name',
      'object_story_spec',
      'object_story_id',
      'asset_feed_spec',
      'url_tags',
      'degrees_of_freedom_spec',
    ],
  },
  'ad.create': { endpoint: (a) => `/${a}/ads`, keys: ['adset_id', ...AD_FIELDS] },
  'ad.update': {
    endpoint: (_a, p) => `/${p.ad_id}`,
    objectKey: 'ad_id',
    keys: ['ad_id', ...AD_FIELDS],
  },
  'ad.update_status': {
    endpoint: (_a, p) => `/${p.ad_id}`,
    objectKey: 'ad_id',
    keys: ['ad_id', 'status'],
  },
  // A/B 테스트(split test). business_id·study_id는 경로에만 쓰고 본문으로 보내지 않는다.
  // 소속 확인은 business와 cells로 한다(assertActionInAccount).
  'adstudy.create': {
    endpoint: (_a, p) => `/${p.business_id}/ad_studies`,
    pathParams: ['business_id'],
    keys: ['business_id', ...STUDY_FIELDS, 'type', 'objectives', 'confidence_level'],
  },
  'adstudy.update': {
    endpoint: (_a, p) => `/${p.study_id}`,
    pathParams: ['study_id'],
    keys: ['study_id', ...STUDY_FIELDS],
  },
} as const satisfies Record<string, MetaActionSpec>

export type MetaActionName = keyof typeof META_ACTIONS

// 예산 파라미터를 실을 수 있는 액션 — metaSpendKrw로 지출 금액을 알려 승인 한도 판정(requiredDecisionRole)에 쓴다.
// 지출 키(META_MONEY_KEYS)는 이 액션들의 허용 목록에만 있다(테스트가 강제).
export const META_BUDGET_ACTIONS: ReadonlySet<MetaActionName> = new Set<MetaActionName>([
  'campaign.create',
  'campaign.update',
  'adset.create',
  'adset.update',
])

/**
 * 승인 한도 판정용 지출 금액(원). 지출 키(예산·지출 상한·입찰가) 중 있는 값의 최댓값, 하나도 없으면 null.
 * KRW 계정 전제: 값이 그대로 원이다(assertMetaTarget이 제안·생성·실행 시점에 KRW로 확인된 계정만 통과시킨다).
 * 값은 변경 후 상한이지 증가분이 아니다. 해석할 수 없는 값(NaN·음수)은 한도를 통과하지 못하도록 MAX_SAFE_INTEGER.
 *
 * 운영 정책(2026-10-14, 재리뷰 Minor 2): 일 예산(daily_budget)과 총액(lifetime_budget·spend_cap 등)을 같은 승인 한도로
 * 비교한다. 일 예산 객체의 end_time·stop_time 연장으로 늘어나는 총지출은 세지 않는다 — ACTIVE 재개와 같이
 * 이미 승인된 일 예산 범위 안의 변경으로 보고 ADMIN 승인에 둔다.
 */
export function metaSpendKrw(params: Params): number | null {
  const vals = META_MONEY_KEYS.map((k) => params[k])
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
// Graph가 요청 해석에 쓰는 예약 파라미터 — 어떤 액션에서도 보내지 않는다(method=delete 같은 메서드 바꿔치기, 인증 덮어쓰기 차단).
const RESERVED_KEYS = new Set([
  'method',
  'access_token',
  'appsecret_proof',
  'batch',
  'debug',
  'fields',
  'suppress_http_code',
  'include_headers',
  'pretty',
  'format',
  'callback',
  'locale',
  'transport',
  'redirect',
  'migrations',
])
// DELETED는 삭제와 같아서 받지 않는다(삭제 액션은 지원하지 않는다).
const STATUSES = new Set(['ACTIVE', 'PAUSED', 'ARCHIVED'])
const CELL_KEYS = new Set(['name', 'description', 'treatment_percentage', 'adsets', 'campaigns'])
// 2026-10-14 운영 확인: targeting 최상위에 둔 상세 타겟은 ACTIVE·검토 통과여도 노출이 0이었다.
// 상세 타겟은 targeting.flexible_spec 안에만 둔다(옛 meta-ads-server validateActionInput 규칙 이식).
const DETAILED_TARGETING_KEYS = [
  'family_statuses',
  'interests',
  'behaviors',
  'life_events',
  'industries',
  'income',
  'work_positions',
  'work_employers',
  'education_statuses',
  'relationship_statuses',
] as const

function looseDetailedTargeting(targeting: unknown): string[] {
  let t = targeting
  if (typeof t === 'string') {
    try {
      t = JSON.parse(t)
    } catch {
      return [] // 형식 오류는 Meta가 거부한다
    }
  }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return []
  return DETAILED_TARGETING_KEYS.filter((k) => Object.hasOwn(t as object, k))
}

/**
 * 액션 이름·params 확인(제안·validateCreate·execute·paramsSchema 공통). 승인한 것만 실행되도록
 * params 키는 액션별 허용 목록만 받고, Graph 예약 파라미터는 따로 거부한다. 경로에 들어가는 id(objectKey·pathParams)는
 * 숫자만 허용한다 — `act_…`나 `/`가 섞이면 다른 객체(광고 계정 자체 등)로 POST가 가기 때문이다.
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
  for (const key of Object.keys(params)) {
    if (RESERVED_KEYS.has(key.toLowerCase()) || key.startsWith('_')) {
      throw new ToolUserError(`예약된 파라미터는 보낼 수 없습니다: ${key}`)
    }
    if (!spec.keys.includes(key)) {
      throw new ToolUserError(`${action}에 허용하지 않는 파라미터입니다: ${key}`)
    }
  }
  const loose = looseDetailedTargeting(params.targeting)
  if (loose.length) {
    throw new ToolUserError(
      `상세 타겟(${loose.join(', ')})은 targeting.flexible_spec 안에 넣어야 합니다(최상위에 두면 노출되지 않습니다)`
    )
  }
  if (
    params.status !== undefined &&
    (typeof params.status !== 'string' || !STATUSES.has(params.status))
  ) {
    throw new ToolUserError('status는 ACTIVE·PAUSED·ARCHIVED만 허용합니다')
  }
  for (const key of [...(spec.objectKey ? [spec.objectKey] : []), ...(spec.pathParams ?? [])]) {
    const id = params[key]
    if (typeof id !== 'string' || !NUMERIC_ID.test(id)) {
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

/** Graph API가 거부·실패한 오류 — 실행 경로는 이 오류만 자격증명 lastError에 기록한다. */
export class MetaApiError extends ToolUserError {
  constructor(message: string) {
    super(message)
    this.name = 'MetaApiError'
  }
}

const GRAPH_TIMEOUT_MS = 15_000

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
  const init: RequestInit = { method, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) }
  if (method === 'GET') {
    for (const [k, v] of entries) url.searchParams.set(k, encode(v))
  } else {
    init.body = new URLSearchParams(entries.map(([k, v]) => [k, encode(v)]))
  }
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    // 오류 객체에 요청 URL(토큰 포함)이 섞일 수 있어 원문을 쓰지 않는다.
    throw new MetaApiError(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Meta API 응답이 없습니다(시간 초과)'
        : 'Meta API에 연결하지 못했습니다'
    )
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!res.ok) {
    throw new MetaApiError(
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

const BUSINESS_UNVERIFIED = '광고 계정의 비즈니스를 확인할 수 없어 실행하지 않았습니다'

async function graphGet<T>(cred: MetaCred, objectId: string, fields: string): Promise<T> {
  return (await graphRequest(cred, 'GET', `/${encodeURIComponent(objectId)}`, { fields })) as T
}

// Graph 목록은 배열이거나 { data: [...] }(필드 확장 edge)다. 다음 페이지가 있으면 전부 확인할 수 없으므로 undefined.
function graphList(v: unknown): unknown[] | undefined {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object' && Array.isArray((v as { data?: unknown }).data)) {
    return (v as { paging?: { next?: unknown } }).paging?.next
      ? undefined
      : (v as { data: unknown[] }).data
  }
  return undefined
}

/**
 * cells(입력 또는 기존 study)의 광고세트·캠페인·광고 계정이 모두 Space 광고 계정 소속인지 확인한다.
 * adaccounts(계정 단위 split test)는 이 액션의 광고 계정과 같아야 한다. 대상이 하나도 없는 셀은 확인할 수 없으므로 거부한다.
 */
async function assertCellsInAccount(cred: MetaCred, cells: unknown[], adAccountId: string) {
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object') {
      throw new ToolUserError('cells 형식이 올바르지 않습니다')
    }
    let targets = 0
    const accounts = (cell as Record<string, unknown>).adaccounts
    if (accounts !== undefined) {
      const ids = graphList(accounts)
      if (!ids) throw new ToolUserError('cells.adaccounts를 확인할 수 없어 실행하지 않았습니다')
      for (const item of ids) {
        const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : item
        if (
          typeof id !== 'string' ||
          !/^(act_)?\d+$/.test(id) ||
          normalizeAdAccountId(id) !== adAccountId
        ) {
          throw new ToolUserError('이 Space의 광고 계정에 속하지 않는 객체입니다')
        }
        targets++
      }
    }
    for (const key of ['adsets', 'campaigns'] as const) {
      const raw = (cell as Record<string, unknown>)[key]
      if (raw === undefined) continue
      const ids = graphList(raw)
      if (!ids) throw new ToolUserError(`cells.${key}를 확인할 수 없어 실행하지 않았습니다`)
      for (const item of ids) {
        const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : item
        if (!NUMERIC_ID.test(String(id))) {
          throw new ToolUserError(`cells.${key}의 id는 숫자여야 합니다`)
        }
        await assertObjectInAccount(cred, String(id), adAccountId)
        targets++
      }
    }
    if (targets === 0) {
      throw new ToolUserError(
        '대상(광고세트·캠페인·광고 계정)이 없는 셀은 확인할 수 없어 실행하지 않았습니다'
      )
    }
  }
}

/**
 * 실행 직전 Space 경계 확인(Graph 조회). 원본에는 없는 workdeck 규칙이다.
 * - 기존 객체 수정: 객체의 account_id가 Space 광고 계정이어야 한다.
 * - adstudy: 대상 비즈니스가 광고 계정을 소유한 비즈니스여야 하고, cells(입력과, update면 기존 study의 cells)의
 *   캠페인·광고세트가 모두 Space 광고 계정 소속이어야 한다. 같은 비즈니스의 다른 계정 study 수정을 막는다.
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

  const account = await graphGet<{ business?: { id?: string } }>(cred, adAccountId, 'business')
  const accountBusiness = account.business?.id
  if (!accountBusiness) throw new ToolUserError(BUSINESS_UNVERIFIED)

  if (action === 'adstudy.create') {
    if (String(params.business_id) !== accountBusiness) {
      throw new ToolUserError('이 Space 광고 계정의 비즈니스가 아닙니다')
    }
  } else {
    // ponytail: cells·cells 안 목록 모두 한 페이지(limit 100·500)만 본다. 다음 페이지가 있으면 거부(닫힌 쪽 실패).
    const study = await graphGet<{ business?: { id?: string }; cells?: unknown }>(
      cred,
      String(params.study_id),
      'business,cells.limit(100){adsets.limit(500){id},campaigns.limit(500){id},adaccounts.limit(500){id}}'
    )
    if (!study.business?.id) throw new ToolUserError(BUSINESS_UNVERIFIED)
    if (study.business.id !== accountBusiness) {
      throw new ToolUserError('이 Space 광고 계정의 비즈니스가 아닙니다')
    }
    const existing = graphList(study.cells)
    if (!existing)
      throw new ToolUserError('기존 A/B 테스트의 cells를 확인할 수 없어 실행하지 않았습니다')
    await assertCellsInAccount(cred, existing, adAccountId)
  }

  if (params.cells === undefined) return
  const cells = typeof params.cells === 'string' ? safeJson(params.cells) : params.cells
  if (!Array.isArray(cells)) throw new ToolUserError('params.cells는 배열이어야 합니다')
  for (const cell of cells) {
    // 허용 목록 — 다른 객체 참조 키(예: adaccounts)로 Space 밖 계정을 끌어오지 못하게 모르는 키는 거부한다.
    const unknownKey =
      cell && typeof cell === 'object' && Object.keys(cell).find((k) => !CELL_KEYS.has(k))
    if (unknownKey) throw new ToolUserError(`cells에 허용하지 않는 키입니다: ${unknownKey}`)
  }
  await assertCellsInAccount(cred, cells, adAccountId)
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
