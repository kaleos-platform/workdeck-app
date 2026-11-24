/**
 * 채널 주문 관측 러너(네이버·쿠팡, 읽기 전용) — 앱의 plan 을 받아 수집하고 ingest/finish 로 보고한다.
 * 카운터 규칙(앱 finish 검증과 맞물림): 외부 목록 페이지 요청 직전 pagesRequested++, 그 페이지 행을
 * 300행 단위로 전부 ingest(빈 페이지도 [] 1회)한 뒤에만 pagesIngested++.
 * 키·토큰·평문 비밀은 로그·에러 코드에 남기지 않는다. 12분 안에 못 끝내면 스스로 timeout 으로 마감한다
 * (서버 lease 15분 — 연장 없음, 커서는 그대로라 다음 회차가 같은 창부터).
 */
import {
  finishChannelOrders,
  getApiCredential,
  getChannelOrdersPlan,
  ingestChannelOrders,
  startChannelOrders,
  WorkerApiError,
  type ChannelOrdersPlanItem,
} from '../api-client.js'
import { CoupangApiClient, CoupangApiError, type CoupangApiConfig } from '../coupang-api/client.js'
import { decryptSecret } from '../encryption.js'
import { issueToken, type NaverCommerceStoreSecret } from '../naver-commerce.js'
import {
  AuthError,
  DeadlineError,
  HttpError,
  StructureError,
  type Hooks,
  type OrderLine,
  type ScanLine,
  type TimeWindow,
} from './common.js'
import { observeCoupang, scanCoupang, type CoupangGet } from './coupang.js'
import { createNaverHttp, observeNaver, scanNaver, type NaverHttp } from './naver.js'

const MAX_INGEST_LINES = 300
export const DEADLINE_MS = 12 * 60_000

export type ChannelOrdersDeps = {
  /** space 워커 토큰 목록(N배송과 같은 NAVER_NBAESONG_WORKER_TOKENS). 비면 [undefined]. */
  keys: () => (string | undefined)[]
  getPlan: typeof getChannelOrdersPlan
  start: typeof startChannelOrders
  ingest: typeof ingestChannelOrders
  finish: typeof finishChannelOrders
  getApiCredential: typeof getApiCredential
  decrypt: (cipher: string, iv: string) => string
  naverHttp: (secret: NaverCommerceStoreSecret) => Promise<NaverHttp>
  coupangGet: (cfg: CoupangApiConfig) => CoupangGet
  now: () => number
  deadlineMs: number
  log: (line: string) => void
}

const defaultDeps: ChannelOrdersDeps = {
  keys: () => {
    const t = (process.env.NAVER_NBAESONG_WORKER_TOKENS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return t.length ? t : [undefined]
  },
  getPlan: getChannelOrdersPlan,
  start: startChannelOrders,
  ingest: ingestChannelOrders,
  finish: finishChannelOrders,
  getApiCredential,
  decrypt: (cipher, iv) => decryptSecret('collection-credential', cipher, iv),
  naverHttp: async (secret) => createNaverHttp(await issueToken(secret)),
  coupangGet: (cfg) => {
    const client = new CoupangApiClient(cfg)
    return (path, query, timeoutMs) => client.get(path, query, timeoutMs)
  },
  now: () => Date.now(),
  deadlineMs: DEADLINE_MS,
  log: (line) => console.log(line),
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 오류 → 서버 ERROR_CODES. */
export function errorCodeOf(e: unknown): string {
  if (e instanceof DeadlineError) return 'timeout'
  if (e instanceof AuthError) return 'auth_error'
  if (e instanceof StructureError) return 'structure_invalid'
  if (e instanceof WorkerApiError) {
    if (e.status === 401 || e.status === 403) return 'auth_error'
    if (e.status === 409) return 'lease_lost'
    if (e.status === 400) return 'invalid'
    return 'api_error'
  }
  if (e instanceof CoupangApiError) {
    return e.reason === 'IP_REJECTED' || e.status === 401 || e.status === 403
      ? 'auth_error'
      : 'api_error'
  }
  if (e instanceof HttpError)
    return e.status === 401 || e.status === 403 ? 'auth_error' : 'api_error'
  return 'worker_failed'
}

async function coupangConfig(
  d: ChannelOrdersDeps,
  vendorId: string | null | undefined
): Promise<CoupangApiConfig> {
  if (!vendorId) throw new AuthError('서버에 쿠팡 vendorId 가 없습니다')
  const cred = await d.getApiCredential()
  if (!cred || !cred.isActive) throw new AuthError('쿠팡 API 자격증명이 없거나 비활성입니다')
  if (cred.vendorId !== vendorId) throw new AuthError('워커·서버 쿠팡 vendorId 가 다릅니다')
  let secretKey: string
  try {
    secretKey = d.decrypt(cred.secretKey, cred.encryptionIv)
  } catch {
    throw new AuthError('쿠팡 자격증명 복호화 실패')
  }
  return { vendorId: cred.vendorId, accessKey: cred.accessKey, secretKey }
}

type Outcome = 'ok' | 'failed' | 'skipped'

async function runOne(
  d: ChannelOrdersDeps,
  key: string | undefined,
  item: ChannelOrdersPlanItem,
  kind: 'OBSERVE' | 'FULL_SCAN'
): Promise<Outcome> {
  const tag = `[channel-orders] channel=${item.channelId} ${item.adapter} ${kind}`
  let start
  try {
    start = await d.start({ channelId: item.channelId, kind }, key)
  } catch (e) {
    if (e instanceof WorkerApiError && (e.status === 409 || e.status === 404)) {
      d.log(`${tag} 건너뜀(${e.status})`)
      return 'skipped'
    }
    d.log(`${tag} 시작 실패: ${msg(e)}`)
    return 'failed'
  }

  const deadline = d.now() + d.deadlineMs
  let windows: TimeWindow[] = []
  const count = { requested: 0, ingested: 0, rows: 0 }
  const check = () => {
    if (d.now() >= deadline) throw new DeadlineError()
  }
  const hooks: Hooks<unknown> = {
    check,
    // 외부 요청 1건 = min(60초, 남은 시한). 이미 지났으면 최소 1ms 로 곧 중단시킨다.
    timeoutMs: () => Math.max(1, Math.min(60_000, deadline - d.now())),
    request: () => {
      check()
      count.requested++
    },
    page: async (lines) => {
      for (let i = 0; i === 0 || i < lines.length; i += MAX_INGEST_LINES) {
        await d.ingest(
          { operationId: start.operationId, lines: lines.slice(i, i + MAX_INGEST_LINES) },
          key
        )
      }
      count.rows += lines.length
      count.ingested++
    },
  }

  let error: unknown
  try {
    windows = Array.isArray(start.windows) ? start.windows : []
    if (item.adapter === 'naver') {
      if (!start.secret) throw new AuthError('네이버 자격증명을 받지 못했습니다')
      let http: NaverHttp
      try {
        http = await d.naverHttp(start.secret)
      } catch {
        throw new AuthError('네이버 토큰 발급 실패')
      }
      if (kind === 'OBSERVE') await observeNaver(http, windows, hooks as Hooks<OrderLine>)
      else await scanNaver(http, windows, hooks as Hooks<ScanLine>)
    } else {
      const get = d.coupangGet(await coupangConfig(d, start.vendorId))
      const vendorId = start.vendorId as string
      if (kind === 'OBSERVE')
        await observeCoupang(get, vendorId, windows, hooks as Hooks<OrderLine>)
      else await scanCoupang(get, vendorId, windows, hooks as Hooks<ScanLine>)
    }
  } catch (e) {
    // 요청 제한 시간 초과(AbortSignal.timeout) — 시한이 지났으면 timeout, 아니면 외부 API 오류.
    const name = (e as { name?: string } | null)?.name
    const aborted = name === 'TimeoutError' || name === 'AbortError'
    error = aborted
      ? d.now() >= deadline
        ? new DeadlineError()
        : new HttpError(0, '외부 요청 제한 시간 초과')
      : e
  }

  const errorCode = error ? errorCodeOf(error) : undefined
  const success = !error && windows.length > 0
  // CoupangApiError 의 message 는 본문을 담지 않지만 방어적으로 status/reason 만 남긴다.
  if (error)
    d.log(
      `${tag} 실패(${errorCode}): ${
        error instanceof CoupangApiError
          ? `coupang status=${error.status} reason=${error.reason}`
          : msg(error)
      }`
    )
  const nowIso = new Date(d.now()).toISOString()
  let result: { accepted: boolean; status: string }
  try {
    result = await d.finish(
      kind === 'OBSERVE'
        ? {
            operationId: start.operationId,
            success,
            ...(success ? { through: windows[windows.length - 1].to } : {}),
            pagesRequested: count.requested,
            pagesIngested: count.ingested,
            rows: count.rows,
            ...(errorCode ? { errorCode } : {}),
          }
        : {
            operationId: start.operationId,
            success,
            periodFrom: windows[0]?.from ?? nowIso,
            periodTo: windows.length ? windows[windows.length - 1].to : nowIso,
            pagesRequested: count.requested,
            pagesReceived: count.ingested,
            structureOk: !(error instanceof StructureError),
            ...(errorCode ? { errorCode } : {}),
          },
      key
    )
  } catch (e) {
    d.log(`${tag} finish 실패: ${msg(e)}`) // 409(만료·이미 마감)도 로그만
    return 'failed'
  }
  const ok = success && result.accepted && result.status === 'SUCCEEDED'
  if (!error)
    d.log(
      `${tag} ${ok ? '완료' : '종료'} status=${result.status} accepted=${result.accepted} pages=${count.ingested} rows=${count.rows}`
    )
  return ok ? 'ok' : 'failed'
}

/**
 * mode OBSERVE = 증분 관측만, DAILY = 증분 관측 뒤 전수 조회(대사 직전).
 * adapter 를 주면 그 어댑터 채널만 — 네이버·쿠팡을 따로 돌릴 때 쓴다.
 */
export async function runChannelOrders(
  mode: 'OBSERVE' | 'DAILY',
  adapter?: 'naver' | 'coupang',
  overrides?: Partial<ChannelOrdersDeps>
): Promise<Record<Outcome | 'planFailed', number>> {
  const d = { ...defaultDeps, ...overrides }
  const total = { ok: 0, failed: 0, skipped: 0, planFailed: 0 }
  for (const key of d.keys()) {
    let items: ChannelOrdersPlanItem[]
    try {
      items = (await d.getPlan(key)).items
    } catch (e) {
      total.planFailed++
      d.log(`[channel-orders] plan 실패: ${msg(e)}`)
      continue
    }
    for (const item of items) {
      if (item.adapter !== 'naver' && item.adapter !== 'coupang') continue
      if (adapter && item.adapter !== adapter) continue
      for (const kind of mode === 'DAILY'
        ? (['OBSERVE', 'FULL_SCAN'] as const)
        : (['OBSERVE'] as const)) {
        total[await runOne(d, key, item, kind)]++
      }
    }
  }
  return total
}
