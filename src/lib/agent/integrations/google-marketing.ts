import { maskSecrets } from '@/lib/agent/audit'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { loadSpaceCredential, recordCredentialError } from './space-credential'

/**
 * 구글 마케팅(GA4·GTM) 클라이언트 — 에밀리 google-marketing-server.mjs 이식.
 * 자격증명은 env 파일이 아니라 Space 암호화 자격증명(provider 'google-marketing')에서 읽는다.
 * GA4·GTM 설정만 바꾼다 — 돈이 나가는 액션(Google Ads 예산 등)은 없어서 spendKrw를 두지 않는다.
 */
export const PROVIDER = 'google-marketing'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GA4_DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta'
export const GA4_ADMIN_BASE = 'https://analyticsadmin.googleapis.com'
export const GTM_BASE = 'https://www.googleapis.com/tagmanager/v2'
const TIMEOUT_MS = 15_000

export interface GoogleSecret {
  clientId: string
  clientSecret: string
  // 「Google로 연결」 승인 전에는 없다 — accessToken() 이 승인 필요 오류를 던진다.
  refreshToken?: string
}
export interface GoogleTarget {
  brand: string
  ga4_property_id: string
  gtm_account_id: string
  gtm_container_id: string
}
export type GoogleStatus = 'needs_auth' | 'needs_check' | 'connected'

export interface GoogleConfig {
  defaultBrand?: string
  // 서버가 관리하는 연결 상태(입력으로 받지 않는다). 없으면 수동 토큰 시절의 기존 행 — 연결됨으로 본다.
  status?: GoogleStatus
  connectedAt?: string
  scopes?: string[]
  credVersion?: number
  // GTM 두 id 는 선택 — 쓰지 않는 브랜드는 둘 다 생략한다.
  brands: Record<
    string,
    Pick<GoogleTarget, 'ga4_property_id'> &
      Partial<Pick<GoogleTarget, 'gtm_account_id' | 'gtm_container_id'>>
  >
}
export interface GoogleCred {
  id: string
  secret: GoogleSecret
  config: GoogleConfig
}

type Api = 'ga4-admin' | 'gtm'
type P = Record<string, unknown>
interface Spec {
  method: 'POST' | 'PATCH' | 'PUT'
  base: string
  api: Api
  endpoint: (t: GoogleTarget, p: P) => string
  // params 안의 리소스 경로 키와 그 경로의 모양(브랜드 속성·컨테이너 접두 뒤). 다른 종류의 리소스로 가는 요청을 막는다.
  pathKey?: 'name' | 'parent' | 'path'
  shape?: string
  // 보낼 수 있는 params 키(허용 목록, pathKey·updateMask 포함). 그 밖의 키는 제안·생성·실행에서 모두 거부한다.
  keys: readonly string[]
}

const strip = (v: unknown) => String(v ?? '').replace(/^\/+/, '')

const WS = '/workspaces/\\d+'
const GA4_DIM = ['parameterName', 'displayName', 'description', 'scope']
const GA4_KEY_EVENT = ['countingMethod', 'defaultValue']
const GTM_COMMON = ['name', 'type', 'parameter', 'notes', 'parentFolderId']
const GTM_TAG = [
  ...GTM_COMMON,
  'firingTriggerId',
  'blockingTriggerId',
  'setupTag',
  'teardownTag',
  'scheduleStartMs',
  'scheduleEndMs',
  'paused',
  'tagFiringOption',
  'liveOnly',
  'priority',
  'consentSettings',
  'monitoringMetadata',
  'monitoringMetadataTagNameKey',
]
const GTM_TRIGGER = [
  ...GTM_COMMON,
  'customEventFilter',
  'filter',
  'autoEventFilter',
  'waitForTags',
  'checkValidation',
  'waitForTagsTimeout',
  'uniqueTriggerId',
  'eventName',
  'interval',
  'limit',
  'selector',
  'intervalSeconds',
  'maxTimerLengthSeconds',
  'verticalScrollPercentageList',
  'horizontalScrollPercentageList',
  'visibilitySelector',
  'visiblePercentageMin',
  'visiblePercentageMax',
  'continuousTimeMinMilliseconds',
  'totalTimeMinMilliseconds',
]
const GTM_VARIABLE = [
  ...GTM_COMMON,
  'scheduleStartMs',
  'scheduleEndMs',
  'enablingTriggerId',
  'disablingTriggerId',
  'formatValue',
]

// 원본 ACTIONS 16개(method·base·endpoint)를 그대로 옮긴다. pathKey 모양·키 허용 목록은 workdeck 규칙이다.
export const GOOGLE_ACTIONS: Record<string, Spec> = {
  'ga4.key_event.create': {
    method: 'POST',
    base: GA4_ADMIN_BASE,
    api: 'ga4-admin',
    endpoint: (t) => `/v1beta/properties/${t.ga4_property_id}/keyEvents`,
    keys: ['eventName', ...GA4_KEY_EVENT],
  },
  'ga4.key_event.patch': {
    method: 'PATCH',
    base: GA4_ADMIN_BASE,
    api: 'ga4-admin',
    pathKey: 'name',
    shape: '/keyEvents/\\d+',
    endpoint: (_t, p) => `/v1beta/${strip(p.name)}`,
    keys: ['name', 'updateMask', ...GA4_KEY_EVENT],
  },
  'ga4.custom_dimension.create': {
    method: 'POST',
    base: GA4_ADMIN_BASE,
    api: 'ga4-admin',
    endpoint: (t) => `/v1beta/properties/${t.ga4_property_id}/customDimensions`,
    keys: [...GA4_DIM, 'disallowAdsPersonalization'],
  },
  'ga4.custom_metric.create': {
    method: 'POST',
    base: GA4_ADMIN_BASE,
    api: 'ga4-admin',
    endpoint: (t) => `/v1beta/properties/${t.ga4_property_id}/customMetrics`,
    keys: [...GA4_DIM, 'measurementUnit', 'restrictedMetricType'],
  },
  'ga4.data_stream.patch': {
    method: 'PATCH',
    base: GA4_ADMIN_BASE,
    api: 'ga4-admin',
    pathKey: 'name',
    shape: '/dataStreams/\\d+',
    endpoint: (_t, p) => `/v1beta/${strip(p.name)}`,
    keys: ['name', 'updateMask', 'displayName', 'webStreamData'],
  },
  'ga4.measurement_protocol_secret.create': {
    method: 'POST',
    base: GA4_ADMIN_BASE,
    api: 'ga4-admin',
    pathKey: 'parent',
    shape: '/dataStreams/\\d+',
    endpoint: (_t, p) => `/v1beta/${strip(p.parent)}/measurementProtocolSecrets`,
    keys: ['parent', 'displayName'],
  },
  'gtm.workspace.create': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    endpoint: (t) => `/accounts/${t.gtm_account_id}/containers/${t.gtm_container_id}/workspaces`,
    keys: ['name', 'description'],
  },
  'gtm.workspace.sync': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'path',
    shape: WS,
    endpoint: (_t, p) => `/${strip(p.path)}:sync`,
    keys: ['path'],
  },
  'gtm.tag.create': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'parent',
    shape: WS,
    endpoint: (_t, p) => `/${strip(p.parent)}/tags`,
    keys: ['parent', ...GTM_TAG],
  },
  'gtm.tag.update': {
    method: 'PUT',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'path',
    shape: `${WS}/tags/\\d+`,
    endpoint: (_t, p) => `/${strip(p.path)}`,
    keys: ['path', ...GTM_TAG],
  },
  'gtm.trigger.create': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'parent',
    shape: WS,
    endpoint: (_t, p) => `/${strip(p.parent)}/triggers`,
    keys: ['parent', ...GTM_TRIGGER],
  },
  'gtm.trigger.update': {
    method: 'PUT',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'path',
    shape: `${WS}/triggers/\\d+`,
    endpoint: (_t, p) => `/${strip(p.path)}`,
    keys: ['path', ...GTM_TRIGGER],
  },
  'gtm.variable.create': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'parent',
    shape: WS,
    endpoint: (_t, p) => `/${strip(p.parent)}/variables`,
    keys: ['parent', ...GTM_VARIABLE],
  },
  'gtm.variable.update': {
    method: 'PUT',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'path',
    shape: `${WS}/variables/\\d+`,
    endpoint: (_t, p) => `/${strip(p.path)}`,
    keys: ['path', ...GTM_VARIABLE],
  },
  'gtm.workspace.create_version': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'path',
    shape: WS,
    endpoint: (_t, p) => `/${strip(p.path)}:create_version`,
    keys: ['path', 'name', 'notes'],
  },
  'gtm.version.publish': {
    method: 'POST',
    base: GTM_BASE,
    api: 'gtm',
    pathKey: 'path',
    shape: '/versions/\\d+',
    endpoint: (_t, p) => `/${strip(p.path)}:publish`,
    keys: ['path'],
  },
}

const NUMERIC_ID = /^\d+$/

export function resolveBrand(config: GoogleConfig, brand?: string): GoogleTarget {
  const selected = brand || config.defaultBrand
  if (!selected) throw new ToolUserError('brand가 필요합니다(기본 브랜드 미설정)')
  const t = Object.hasOwn(config.brands ?? {}, selected) ? config.brands[selected] : undefined
  if (!t) throw new ToolUserError(`알 수 없는 구글 마케팅 브랜드: ${selected}`)
  // 숫자 id만 — 경로 검사 정규식에 그대로 들어간다.
  if (!NUMERIC_ID.test(String(t.ga4_property_id ?? ''))) {
    throw new ToolUserError(`브랜드 ${selected}에 ga4_property_id가 없거나 숫자가 아닙니다`)
  }
  // GTM 두 id는 선택: 둘 다 없거나(''), 둘 다 숫자여야 한다.
  const gtmAccount = String(t.gtm_account_id ?? '')
  const gtmContainer = String(t.gtm_container_id ?? '')
  if (gtmAccount || gtmContainer) {
    for (const [k, v] of [
      ['gtm_account_id', gtmAccount],
      ['gtm_container_id', gtmContainer],
    ] as const) {
      if (!NUMERIC_ID.test(v)) {
        throw new ToolUserError(`브랜드 ${selected}에 ${k}가 없거나 숫자가 아닙니다`)
      }
    }
  }
  return {
    brand: selected,
    ga4_property_id: String(t.ga4_property_id),
    gtm_account_id: gtmAccount,
    gtm_container_id: gtmContainer,
  }
}

// GA4·GTM 리소스 경로 문자만. %(인코딩), .(dot segment), ?, #, \ 를 모두 거부한다.
const SAFE_PATH_RE = /^[A-Za-z0-9_:/-]+$/

// 경로 정규식에 id를 escape 없이 넣는다 — resolveBrand가 숫자 id(^\d+$)만 통과시키는 것에 의존한다
// (actions의 target도 paramsSchema가 숫자만 받고 assertGoogleTarget이 resolveBrand 결과와 비교한다).
// GTM 미설정 브랜드(id '')는 여기서 막는다 — 빈 id가 정규식에 들어가 다른 경로를 통과시키지 않게(GTM 도구·액션 공통 관문).
const targetPrefix = (t: GoogleTarget, api: Api) => {
  if (api === 'ga4-admin') return `properties/${t.ga4_property_id}`
  if (!t.gtm_account_id || !t.gtm_container_id) {
    throw new ToolUserError('이 브랜드에는 GTM 컨테이너가 설정되지 않았습니다')
  }
  return `accounts/${t.gtm_account_id}/containers/${t.gtm_container_id}`
}

/**
 * 경로가 브랜드의 GA4 속성 또는 GTM 컨테이너 아래인지 확인하고, 앞의 '/'를 뗀 경로를 돌려준다
 * (같은 OAuth 토큰으로 볼 수 있는 다른 속성·컨테이너 차단). 요청에는 targetUrl의 결과만 쓴다.
 */
export function assertPathInTarget(path: string, t: GoogleTarget, api: Api): string {
  const prefix = targetPrefix(t, api) // GTM 미설정이면 경로 검사보다 먼저 명확한 오류로 거부
  const p = strip(path)
  if (!SAFE_PATH_RE.test(p) || p.includes('//')) {
    throw new ToolUserError('경로에 허용되지 않는 문자(%, ., ?, #, \\, //)가 있습니다')
  }
  if (api === 'ga4-admin') {
    if (!new RegExp(`^(v1(beta|alpha)/)?${prefix}(/|:|$)`).test(p)) {
      throw new ToolUserError('이 브랜드의 GA4 속성 경로가 아닙니다')
    }
  } else if (!new RegExp(`^${prefix}(/|:|$)`).test(p)) {
    throw new ToolUserError('이 브랜드의 GTM 컨테이너 경로가 아닙니다')
  }
  return p
}

/**
 * 조회·실행 공통 요청 URL. 문자열 검사 뒤 new URL로 정규화한 **최종 pathname**을 다시 확인한다
 * (정규화로 경로가 바뀌면 거부). googleRequest는 이 함수(또는 actionUrl)가 돌려준 URL만 받는다.
 */
export function targetUrl(base: string, path: string, t: GoogleTarget, api: Api): URL {
  const p = assertPathInTarget(path, t, api)
  const url = new URL(`${base}/${p}`)
  const expected = `${new URL(base).pathname.replace(/\/$/, '')}/${p}`
  if (url.origin !== new URL(base).origin || url.pathname !== expected || url.search || url.hash) {
    throw new ToolUserError('정규화된 요청 경로가 검사한 경로와 다릅니다')
  }
  return url
}

/**
 * 액션의 최종 요청 URL(브랜드 범위·리소스 모양 밖이면 throw). 제안·생성·실행이 같은 함수를 쓴다.
 * updateMask(PATCH)는 검사가 끝난 URL에 쿼리로만 붙인다.
 */
export function actionUrl(action: string, params: P, t: GoogleTarget): URL {
  const spec = GOOGLE_ACTIONS[action]
  if (spec.pathKey) {
    const raw = strip(params[spec.pathKey])
    if (!new RegExp(`^${targetPrefix(t, spec.api)}${spec.shape}$`).test(raw)) {
      throw new ToolUserError(
        spec.api === 'gtm'
          ? `params.${spec.pathKey}가 이 브랜드의 GTM 컨테이너 경로가 아닙니다`
          : `params.${spec.pathKey}가 이 브랜드의 GA4 속성 경로가 아닙니다`
      )
    }
  }
  const url = targetUrl(spec.base, spec.endpoint(t, params), t, spec.api)
  if (typeof params.updateMask === 'string') url.searchParams.set('updateMask', params.updateMask)
  return url
}

/**
 * payload의 대상(속성·컨테이너)이 현재 Space config의 같은 브랜드 매핑과 같은지 확인하고 현재 대상을 돌려준다.
 * 세션 POST로 만든 임의 target, 매핑 변경 뒤의 기존 제안을 막는다.
 */
export function assertGoogleTarget(config: GoogleConfig, target: GoogleTarget): GoogleTarget {
  const mismatch = () =>
    new ToolUserError(
      '구글 마케팅 대상 매핑이 바뀌었거나 이 작업 공간에 등록되지 않은 대상입니다. 다시 제안하세요'
    )
  let current: GoogleTarget
  try {
    current = resolveBrand(config, target.brand)
  } catch {
    throw mismatch()
  }
  if (
    current.ga4_property_id !== target.ga4_property_id ||
    current.gtm_account_id !== target.gtm_account_id ||
    current.gtm_container_id !== target.gtm_container_id
  ) {
    throw mismatch()
  }
  return current
}

// Google API가 요청 해석에 쓰는 시스템 파라미터 — 본문·쿼리 어디로도 보내지 않는다(소문자 비교).
const RESERVED_KEYS = new Set([
  'access_token',
  'oauth_token',
  'key',
  'alt',
  'fields',
  'prettyprint',
  'quotauser',
  'userip',
  'uploadtype',
  'upload_protocol',
  'callback',
  '$.xgafv',
])
const isReserved = (k: string) =>
  RESERVED_KEYS.has(k.toLowerCase()) || k.startsWith('_') || k.startsWith('$')

/** 조회 도구 query 키 확인 — 시스템 파라미터(인증·응답 형식 바꿔치기)를 막는다. */
export function assertQueryKeys(query: Record<string, string>): Record<string, string> {
  for (const k of Object.keys(query)) {
    if (isReserved(k)) throw new ToolUserError(`예약된 파라미터는 보낼 수 없습니다: ${k}`)
  }
  return query
}

// 운영 결정(2026-10-14, Task 11 리뷰·재리뷰): 에이전트는 코드 없는 표준 GTM 타입만 만들거나 고칠 수 있다(허용 목록).
// 맞춤 HTML(html)·맞춤 JS 변수(jsm)·맞춤 이미지(img)·커스텀 템플릿(cvt_*)·레거시 UA·서드파티 픽셀·알 수 없는 타입은
// 임의 코드 실행이나 임의 URL 전송이 될 수 있는데 승인 화면에 내용이 보이지 않으므로 모두 거부한다.
// 여기에 타입을 추가할 때는 그 타입이 임의 코드를 실행할 수 없는 경우에만 추가한다(add a type here only if it cannot run custom code).
export const AGENT_GTM_TAG_TYPES: ReadonlySet<string> = new Set([
  'gaawe', // GA4 이벤트
  'googtag', // Google 태그
  'awct', // Google Ads 전환 추적
  'sp', // Google Ads 리마케팅
  'gclidw', // 전환 링커
])
export const AGENT_GTM_VARIABLE_TYPES: ReadonlySet<string> = new Set([
  'v', // 데이터 영역
  'c', // 상수
  'u', // URL
  'k', // 1st-party 쿠키
  'e', // 맞춤 이벤트
  'aev', // 자동 이벤트
  'd', // DOM 요소
  'f', // 리퍼러
  'smm', // 조회 테이블
  'remm', // 정규식 테이블
  'gas', // Google 애널리틱스 설정
  'gtes', // Google 태그: 이벤트 설정
  // 'j'(JavaScript 전역 변수 읽기)는 보수적으로 제외한다.
])

/**
 * GTM 태그·변수 type 확인(제안 params와 실행 시점의 기존 리소스 모두). 허용 목록에 없거나 문자열이 아니면 거부한다
 * (닫힌 쪽 실패). 대소문자는 무시한다.
 */
export function assertAgentGtmType(type: unknown, kind: 'tag' | 'variable'): void {
  if (type === undefined)
    throw new ToolUserError(`GTM ${kind === 'tag' ? '태그' : '변수'} type이 필요합니다`)
  const allowed = kind === 'tag' ? AGENT_GTM_TAG_TYPES : AGENT_GTM_VARIABLE_TYPES
  if (typeof type !== 'string' || !allowed.has(type.toLowerCase())) {
    throw new ToolUserError(
      `에이전트는 표준 GTM ${kind === 'tag' ? '태그' : '변수'} 타입(${[...allowed].join(', ')})만 만들거나 고칠 수 있습니다. 맞춤 HTML·JavaScript·이미지·커스텀 템플릿 등은 GTM 화면에서 직접 만들어 주세요`
    )
  }
}

const UPDATE_MASK_RE = /^[A-Za-z_.]+(,[A-Za-z_.]+)*$/

/**
 * 액션 이름·params 확인(제안·paramsSchema·validateCreate·execute 공통). 승인한 것만 실행되도록
 * params 키는 액션별 허용 목록만 받고, 예약 키는 따로 거부한다. 경로 키·updateMask는 문자열이어야 한다.
 */
export function validateGoogleAction(input: { action: unknown; params: unknown }): {
  action: string
  params: P
} {
  if (typeof input.action !== 'string' || !Object.hasOwn(GOOGLE_ACTIONS, input.action)) {
    throw new ToolUserError(`지원하지 않는 구글 마케팅 액션: ${String(input.action)}`)
  }
  if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) {
    throw new ToolUserError('params는 객체여야 합니다')
  }
  const action = input.action
  const params = input.params as P
  const spec = GOOGLE_ACTIONS[action]
  for (const key of Object.keys(params)) {
    if (isReserved(key)) throw new ToolUserError(`예약된 파라미터는 보낼 수 없습니다: ${key}`)
    if (!spec.keys.includes(key)) {
      throw new ToolUserError(`${action}에 허용하지 않는 파라미터입니다: ${key}`)
    }
  }
  const gtmKind = /^gtm\.(tag|variable)\.(create|update)$/.exec(action)
  if (gtmKind) {
    // create는 type 필수. update에서 생략하면 기존 type을 유지한다 — 기존 type은 execute가 조회해 확인한다.
    if (gtmKind[2] === 'create' || params.type !== undefined) {
      assertAgentGtmType(params.type, gtmKind[1] as 'tag' | 'variable')
    }
  } else if (params.type !== undefined && typeof params.type !== 'string') {
    throw new ToolUserError('type은 문자열이어야 합니다')
  }
  if (spec.pathKey && typeof params[spec.pathKey] !== 'string') {
    throw new ToolUserError(`params.${spec.pathKey}는 리소스 경로 문자열이어야 합니다`)
  }
  if (params.updateMask !== undefined) {
    // updateMask는 이 액션이 본문으로 보낼 수 있는 필드만 가리킬 수 있다(예: 속성 자체 필드를 비우는 마스크 차단).
    const body = spec.keys.filter((k) => k !== spec.pathKey && k !== 'updateMask')
    if (
      typeof params.updateMask !== 'string' ||
      !UPDATE_MASK_RE.test(params.updateMask) ||
      params.updateMask
        .split(',')
        // GA4 문서는 snake_case(counting_method)로 쓴다 — 비교만 camelCase로 하고 원문은 그대로 보낸다.
        .some(
          (f) =>
            !body.includes(f.split('.')[0].replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()))
        )
    ) {
      throw new ToolUserError(`updateMask는 ${body.join(', ')} 필드만 가리킬 수 있습니다`)
    }
  }
  return { action, params }
}

// RunReportRequest 본문 키(property는 경로로만 정한다).
const RUN_REPORT_KEYS = new Set([
  'dimensions',
  'metrics',
  'dateRanges',
  'dimensionFilter',
  'metricFilter',
  'offset',
  'limit',
  'metricAggregations',
  'orderBys',
  'currencyCode',
  'cohortSpec',
  'keepEmptyRows',
  'returnPropertyQuota',
  'comparisons',
])

export function validateGa4RunReportRequest(request: unknown): P {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ToolUserError('request는 객체여야 합니다')
  }
  const r = request as { dimensions?: unknown; metrics?: unknown }
  for (const k of Object.keys(r)) {
    if (!RUN_REPORT_KEYS.has(k)) throw new ToolUserError(`runReport에 허용하지 않는 키입니다: ${k}`)
  }
  const names = (v: unknown) =>
    Array.isArray(v) ? v.map((x) => (x as { name?: unknown } | null)?.name) : []
  if (names(r.dimensions).includes('dateRange')) {
    throw new ToolUserError(
      'dateRange는 GA4 dimension이 아닙니다. 기간별로 runReport를 따로 호출하세요.'
    )
  }
  if (names(r.metrics).includes('purchases')) {
    throw new ToolUserError('구매 수는 purchases 대신 ecommercePurchases를 쓰세요.')
  }
  return r as P
}

/** 응답에서 자격증명처럼 보이는 키·토큰 포함 URL을 지운다(원본 규칙). 페이지 토큰은 비밀이 아니라 남긴다. */
export function sanitizeGoogleResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeGoogleResponse)
  if (!value || typeof value !== 'object') return value
  const out: P = {}
  for (const [k, v] of Object.entries(value)) {
    if (/token|secret|credential|authorization/i.test(k) && !/^(next)?PageToken$/i.test(k)) {
      out[k] = '[redacted]'
    } else if (
      typeof v === 'string' &&
      /[?&](access_token|refresh_token|client_secret)=/i.test(v)
    ) {
      out[k] = '[redacted]'
    } else {
      out[k] = sanitizeGoogleResponse(v)
    }
  }
  return out
}

/** 본문에서 경로 전용 키를 뺀다(원본 cleanBodyParams). updateMask는 쿼리로 간다. */
export function cleanBodyParams(params: P, action: string): P {
  const body = { ...params }
  delete body.parent
  delete body.path
  delete body.updateMask
  if (!action.startsWith('gtm.')) delete body.name
  return body
}

export async function loadGoogleCred(spaceId: string, audit: string[]): Promise<GoogleCred> {
  const c = await loadSpaceCredential<GoogleSecret>(spaceId, PROVIDER, audit)
  return { id: c.id, secret: c.secret, config: c.config as unknown as GoogleConfig }
}

/**
 * Google OAuth·API가 거부·실패한 오류. record=true(인증·권한 실패)만 자격증명 lastError 에 남긴다 —
 * 잘못된 경로(404)·요청(400)·일시 장애(429·5xx·시간 초과)는 자격증명 문제가 아니라 호출 오류다.
 */
export class GoogleApiError extends ToolUserError {
  constructor(
    message: string,
    readonly record = true
  ) {
    super(maskSecrets(message))
    this.name = 'GoogleApiError'
  }
}

// 자격증명(토큰·권한) 문제로 볼 Google API 응답 코드.
const CREDENTIAL_ERROR_STATUS = new Set([401, 403])

// 오류 객체에 요청 본문(refresh token)·헤더가 섞일 수 있어 원문을 쓰지 않는다.
async function send(url: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new GoogleApiError(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Google API 응답이 없습니다(시간 초과)'
        : 'Google API에 연결하지 못했습니다',
      false
    )
  }
}

async function accessToken(cred: GoogleCred): Promise<string> {
  if (!cred.secret.refreshToken) {
    throw new GoogleApiError('Google 연결(승인)이 필요합니다', false)
  }
  const body = new URLSearchParams({
    client_id: cred.secret.clientId,
    client_secret: cred.secret.clientSecret,
    refresh_token: cred.secret.refreshToken,
    grant_type: 'refresh_token',
  })
  const res = await send(TOKEN_URL, { method: 'POST', body })
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !data.access_token) {
    throw new GoogleApiError(
      data.error_description || data.error || `Google OAuth 토큰 요청 실패 (${res.status})`
    )
  }
  return data.access_token
}

/** 연동 점검용 — refresh token 으로 access token 을 받아 본다(데이터 API는 부르지 않는다). */
export async function verifyGoogleCred(cred: GoogleCred): Promise<void> {
  await accessToken(cred)
}

/**
 * Google API 호출. checkedUrl은 targetUrl/actionUrl이 검사한 URL이거나 config 숫자 id로만 만든 URL(runReport)이어야 한다.
 * 토큰은 서버 안에서만 쓰고, 응답의 자격증명 값은 지우고, OAuth 실패·401·403만 자격증명 lastError에 남긴다.
 */
export async function googleRequest(
  cred: GoogleCred,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  checkedUrl: URL,
  bodyOrQuery: P = {}
): Promise<unknown> {
  try {
    const token = await accessToken(cred)
    const url = new URL(checkedUrl) // 쿼리를 붙이므로 복사본을 쓴다
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    const init: RequestInit = { method, headers }
    if (method === 'GET') {
      for (const [k, v] of Object.entries(bodyOrQuery)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
      }
    } else {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(bodyOrQuery)
    }
    const res = await send(url, init)
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (!res.ok) {
      throw new GoogleApiError(
        data?.error?.message || `Google API 요청 실패 (${res.status})`,
        CREDENTIAL_ERROR_STATUS.has(res.status)
      )
    }
    return sanitizeGoogleResponse(data)
  } catch (err) {
    if (err instanceof GoogleApiError && err.record)
      await recordCredentialError(cred.id, err.message)
    throw err
  }
}

// ---- 「Google로 연결」 OAuth(승인 코드 흐름) ----
// 비밀값 규칙: 토큰·응답 본문·요청 헤더는 오류·로그·DB 어디에도 넣지 않는다.
// 오류는 GoogleOAuthError(단계명 + HTTP 상태 + 허용 목록의 error 코드)만 던진다.
export const GOOGLE_STATE_PURPOSE = 'google-marketing'
export const GOOGLE_NONCE_COOKIE = 'google_oauth_nonce'
export const GOOGLE_COOKIE_PATH = '/api/integrations/google'
export const GOOGLE_CALLBACK_PATH = '/api/integrations/google/callback'
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE_BASE = 'https://www.googleapis.com/auth/'
const GA4_SCOPES = ['analytics.readonly', 'analytics.edit'].map((s) => SCOPE_BASE + s)
const GTM_SCOPES = [
  'tagmanager.readonly',
  'tagmanager.edit.containers',
  'tagmanager.edit.containerversions',
  'tagmanager.publish',
].map((s) => SCOPE_BASE + s)

const KNOWN_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'invalid_request',
  'unauthorized_client',
  'invalid_scope',
  'redirect_uri_mismatch',
  'rate_limited',
  'unauthorized',
  'forbidden',
  'not_found',
  'server_error',
  'network',
  'invalid_response',
])

export class GoogleOAuthError extends Error {
  constructor(
    readonly stage: string,
    readonly code: string,
    readonly status?: number
  ) {
    super(`Google ${stage} 실패${status ? ` (HTTP ${status})` : ''}: ${code}`)
    this.name = 'GoogleOAuthError'
  }
}

/** 필수 승인 범위 — GA4 는 항상, GTM 범위는 GTM 이 설정된 브랜드가 하나라도 있을 때만. */
export function requiredGoogleScopes(config: Pick<GoogleConfig, 'brands'>): string[] {
  const hasGtm = Object.values(config.brands ?? {}).some(
    (b) => !!b?.gtm_account_id && !!b?.gtm_container_id
  )
  return hasGtm ? [...GA4_SCOPES, ...GTM_SCOPES] : [...GA4_SCOPES]
}

export const hasGoogleScopes = (granted: string[] | undefined, required: string[]) =>
  required.every((s) => granted?.includes(s))

export function googleAuthorizeUrl(
  clientId: string,
  scopes: string[],
  state: string,
  redirectUri: string
): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  return url.toString()
}

async function oauthHttp(stage: string, url: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new GoogleOAuthError(stage, 'network') // 원 오류 메시지는 버린다
  }
}

async function oauthErrorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  if (typeof body?.error === 'string' && KNOWN_CODES.has(body.error)) return body.error
  if (res.status === 401) return 'unauthorized'
  if (res.status === 403) return 'forbidden'
  if (res.status === 404) return 'not_found'
  if (res.status === 429) return 'rate_limited'
  return res.status >= 500 ? 'server_error' : 'unknown'
}

/** 승인 코드를 토큰으로 교환한다. redirectUri 는 install 과 바이트 동일해야 한다. */
export async function exchangeGoogleCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<{ refreshToken?: string; accessToken: string; scopes: string[] }> {
  const res = await oauthHttp('토큰 교환', TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new GoogleOAuthError('토큰 교환', await oauthErrorCode(res), res.status)
  const b = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (typeof b?.access_token !== 'string') {
    throw new GoogleOAuthError('토큰 교환', 'invalid_response')
  }
  return {
    accessToken: b.access_token,
    refreshToken:
      typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : undefined,
    scopes: typeof b.scope === 'string' ? b.scope.split(/\s+/).filter(Boolean) : [],
  }
}

/** 브랜드마다 GA4 속성 1건을 조회한다(접근 권한 확인). 실패하면 GoogleOAuthError(상태·코드만). */
export async function verifyGoogleBrands(cred: GoogleCred, token?: string): Promise<void> {
  const bearer = token ?? (await accessToken(cred))
  for (const brand of Object.keys(cred.config.brands ?? {})) {
    const t = resolveBrand(cred.config, brand)
    const url = targetUrl(GA4_ADMIN_BASE, `v1beta/properties/${t.ga4_property_id}`, t, 'ga4-admin')
    const res = await oauthHttp('속성 확인', url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}` },
    })
    if (!res.ok) throw new GoogleOAuthError('속성 확인', await oauthErrorCode(res), res.status)
  }
}
