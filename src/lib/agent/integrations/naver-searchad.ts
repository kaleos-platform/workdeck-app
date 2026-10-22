import crypto from 'node:crypto'
import { maskSecrets } from '@/lib/agent/audit'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { loadSpaceCredential, recordCredentialError } from './space-credential'

/**
 * 네이버 검색광고 API 클라이언트 — 조회 전용.
 * 자격증명은 Space 암호화 자격증명(provider 'naver-searchad')에서 읽는다. 키 1벌로 여러 광고 계정을 조회하고,
 * 계정은 X-Customer(검색광고 CUSTOMER_ID, 통합 광고계정번호 아님)로 고른다.
 * 경로·서명은 공식 샘플(naver/searchad-apidoc python·php)을 따른다 — 스펙 JSON의 `/api` 접두는 내부 경로라 쓰지 않는다.
 */
export const PROVIDER = 'naver-searchad'
export const BASE_URL = 'https://api.searchad.naver.com'
const TIMEOUT_MS = 20_000
const MAX_429_RETRIES = 2

export interface NaverSecret {
  apiKey: string
  secretKey: string
}
// customers: 브랜드 키 → 검색광고 CUSTOMER_ID. 도구 입력으로는 브랜드만 받는다(임의 customerId로 X-Customer 를 바꿀 수 없게).
// managerCustomerId: API 키를 발급한 계정. /customer-links 조회와 자격증명 점검에만 쓴다.
export interface NaverConfig {
  defaultBrand?: string
  managerCustomerId: string
  customers: Record<string, string>
}
export interface NaverCred {
  id: string
  secret: NaverSecret
  config: NaverConfig
}

type Query = Record<string, string | number | undefined>

export class NaverApiError extends ToolUserError {
  constructor(message: string) {
    super(message)
    this.name = 'NaverApiError'
  }
}

export async function loadNaverCred(spaceId: string, audit: string[]): Promise<NaverCred> {
  const c = await loadSpaceCredential<NaverSecret>(spaceId, PROVIDER, audit)
  return { id: c.id, secret: c.secret, config: c.config as unknown as NaverConfig }
}

export function resolveCustomer(config: NaverConfig, brand?: string): string {
  const selected = brand || config.defaultBrand
  if (!selected) throw new ToolUserError('brand가 필요합니다(기본 브랜드 미설정)')
  const id = Object.hasOwn(config.customers ?? {}, selected)
    ? config.customers[selected]
    : undefined
  if (!id) throw new ToolUserError(`알 수 없는 네이버 광고 브랜드: ${selected}`)
  return id
}

/** 서명 원문은 `{timestamp}.{METHOD}.{path}` — 쿼리스트링은 넣지 않는다. */
export function sign(secretKey: string, timestamp: string, method: string, path: string): string {
  return crypto
    .createHmac('sha256', secretKey)
    .update(`${timestamp}.${method}.${path}`)
    .digest('base64')
}

function headers(secret: NaverSecret, customerId: string, method: string, path: string) {
  const ts = String(Date.now())
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Timestamp': ts,
    'X-API-KEY': secret.apiKey,
    'X-Customer': customerId,
    'X-Signature': sign(secret.secretKey, ts, method, path),
  }
}

/**
 * 서명 요청 1건. 429(광고주별 동적 제한)는 짧게 최대 2회 재시도한다 — 서버리스 시간 제한 안에서 끝내야 한다.
 * 비-JSON 응답(리포트 TSV)은 text 로 돌려준다.
 */
export async function naverRequest(
  secret: NaverSecret,
  customerId: string,
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Query; body?: unknown; url?: string } = {}
): Promise<unknown> {
  const url = new URL(opts.url ?? `${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: headers(secret, customerId, method, path),
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // 오류 객체에 요청 URL(리포트 authtoken 포함)이 섞일 수 있어 원문을 쓰지 않는다.
      throw new NaverApiError(
        err instanceof Error && err.name === 'TimeoutError'
          ? '네이버 검색광고 API 응답이 없습니다(시간 초과)'
          : '네이버 검색광고 API에 연결하지 못했습니다'
      )
    }
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      let msg = `네이버 검색광고 API 요청 실패 (${res.status})`
      try {
        const j = JSON.parse(text) as { title?: string; detail?: string; message?: string }
        const detail = j.detail || j.title || j.message
        if (detail) msg = `${msg}: ${detail}`
      } catch {
        // 본문이 JSON 이 아니면 상태 코드만 쓴다.
      }
      throw new NaverApiError(maskSecrets(msg).slice(0, 500))
    }
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
}

/** 호출 실패를 자격증명 lastError 에 남기고 다시 던진다. */
export async function withCredError<T>(cred: NaverCred, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof NaverApiError) await recordCredentialError(cred.id, err.message)
    throw err
  }
}

/** 리포트 downloadUrl 은 네이버 응답에서 오지만 서명 헤더를 실어 보내므로 https·naver.com 호스트만 허용한다. */
export function assertDownloadUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new NaverApiError('리포트 다운로드 주소가 올바르지 않습니다')
  }
  if (
    u.protocol !== 'https:' ||
    !(u.hostname === 'naver.com' || u.hostname.endsWith('.naver.com'))
  ) {
    throw new NaverApiError('허용하지 않는 리포트 다운로드 주소입니다')
  }
  return u.toString()
}

/** 대용량 리포트 TSV(헤더 없음) → 행 배열. */
export function parseTsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split('\t'))
}

/**
 * 자격증명 저장·점검용 가벼운 확인 — 매핑된 각 광고 계정으로 캠페인 목록을 1번씩 조회한다.
 * 하나라도 실패하면 throw(저장하지 않는다).
 */
export async function verifyNaverCred(
  secret: NaverSecret,
  config: Pick<NaverConfig, 'customers'>
): Promise<void> {
  for (const customerId of new Set(Object.values(config.customers))) {
    await naverRequest(secret, customerId, 'GET', '/ncc/campaigns', { query: { recordSize: 1 } })
  }
}
