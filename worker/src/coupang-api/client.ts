/**
 * 쿠팡 Open API HTTP 클라이언트
 *
 * - buildAuthorization() 으로 서명한 Authorization 헤더 + X-Requested-By(vendorId) 부착
 * - 429(Too Many Requests) 지수 백오프 재시도(최대 3회)
 * - 호출 간 최소 1,300ms 스로틀(분당 50회 제한 대응 — 60000/50=1200ms 여유분 포함)
 * - nextToken 페이징 자동 순회, maxPages 초과 시 명시적 실패
 * - IP allowlist 미등록으로 인한 거부를 다른 실패와 구분해 분류(orchestrator 알림 문구용)
 */
import { buildAuthorization } from './signature.js'

export const COUPANG_API_BASE = 'https://api-gateway.coupang.com'

/** 호출 간 최소 간격(ms). 분당 50회 제한(60000/50=1200ms) 대비 여유분 포함. */
const MIN_INTERVAL_MS = 1300
/** 429 재시도 최대 횟수 */
const MAX_RETRIES = 3
/** paginate() 안전장치 — 무한 루프 방지 */
const DEFAULT_MAX_PAGES = 500

export interface CoupangApiConfig {
  vendorId: string
  accessKey: string
  secretKey: string
}

/** 쿠팡 API 호출 실패 사유 분류. IP_REJECTED 는 Wing allowlist 미등록 — 별도 알림 문구가 필요하다. */
export type CoupangApiFailureReason = 'IP_REJECTED' | 'RATE_LIMITED' | 'UNKNOWN'

export class CoupangApiError extends Error {
  readonly reason: CoupangApiFailureReason
  readonly status?: number
  readonly body?: string
  constructor(reason: CoupangApiFailureReason, message: string, status?: number, body?: string) {
    super(message)
    this.name = 'CoupangApiError'
    this.reason = reason
    this.status = status
    this.body = body
  }
}

/**
 * 응답 상태/본문으로 IP 거부(allowlist 미등록) 여부를 분류한다.
 * `login-guard.ts:49 classifyLoginFailure()` 와 같은 역할 — 실패 유형을 사람이 바로
 * 이해할 수 있는 사유로 나눠 알림 문구를 정확하게 만든다.
 * 쿠팡 Open API 는 미등록 IP 호출 시 대개 403 과 함께 "허용되지 않은 IP" 류 메시지를 준다
 * (정확한 코드/문구는 문서에 명시돼 있지 않아 상태코드+키워드 휴리스틱으로 분류한다).
 */
export function classifyApiFailure(status: number, body: string): CoupangApiFailureReason {
  if (status === 429) return 'RATE_LIMITED'
  if (status === 403 || status === 401) {
    if (/ip|허용되지 않|접근이 거부|not allowed|access denied|whitelist|allowlist/i.test(body)) {
      return 'IP_REJECTED'
    }
  }
  return 'UNKNOWN'
}

/** query 파라미터 객체를 '?' 없는 쿼리 문자열로 만든다. undefined 값은 제외. 삽입 순서 유지(정렬 안 함). */
export function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    parts.push(`${key}=${encodeURIComponent(String(value))}`)
  }
  return parts.join('&')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class CoupangApiClient {
  private readonly cfg: CoupangApiConfig
  private lastCallAt = 0

  constructor(cfg: CoupangApiConfig) {
    this.cfg = cfg
  }

  /** 분당 50회 제한 대응 — 직전 호출로부터 최소 MIN_INTERVAL_MS 가 지날 때까지 대기. */
  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt
    if (elapsed < MIN_INTERVAL_MS) {
      await sleep(MIN_INTERVAL_MS - elapsed)
    }
    this.lastCallAt = Date.now()
  }

  /**
   * GET 호출. 서명 + X-Requested-By 헤더를 부착하고, 429는 지수 백오프로 최대 MAX_RETRIES 회
   * 재시도한다. IP 거부 등 다른 실패는 즉시 CoupangApiError 로 던진다.
   */
  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const queryStr = buildQueryString(query)
    const url = `${COUPANG_API_BASE}${path}${queryStr ? `?${queryStr}` : ''}`

    let attempt = 0
    for (;;) {
      await this.throttle()

      const authorization = buildAuthorization({
        method: 'GET',
        path,
        query: queryStr,
        accessKey: this.cfg.accessKey,
        secretKey: this.cfg.secretKey,
      })

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          Authorization: authorization,
          'X-Requested-By': this.cfg.vendorId,
        },
      })

      if (response.ok) {
        return (await response.json()) as T
      }

      const body = await response.text().catch(() => '')
      const reason = classifyApiFailure(response.status, body)

      if (reason === 'RATE_LIMITED' && attempt < MAX_RETRIES) {
        attempt += 1
        const backoffMs = MIN_INTERVAL_MS * 2 ** attempt
        console.warn(
          `[coupang-api] 429 재시도 ${attempt}/${MAX_RETRIES} — ${backoffMs}ms 대기 (${path})`
        )
        await sleep(backoffMs)
        continue
      }

      throw new CoupangApiError(
        reason,
        `쿠팡 API 호출 실패 [${response.status}]: ${path} — ${body.slice(0, 500)}`,
        response.status,
        body
      )
    }
  }

  /**
   * nextToken 기반 페이징을 자동 순회한다.
   * @param pick 응답에서 이번 페이지 items 와 다음 페이지 nextToken 을 뽑아내는 함수
   * @param maxPages 안전장치 — 초과 시 throw(무한 루프 방지)
   */
  async paginate<T, R = unknown>(
    path: string,
    query: Record<string, string | number | undefined> | undefined,
    pick: (res: R) => { items: T[]; nextToken?: string | null },
    maxPages = DEFAULT_MAX_PAGES,
    // 페이징 토큰 쿼리 파라미터 이름. 대부분 'nextToken' 이지만 정산(revenue-history)은
    // 'token' 을 요구하고, 이름이 틀리면 서버가 매번 첫 페이지 + 같은 nextToken 을 돌려줘
    // maxPages 까지 무한 반복한다(실제로 12일 조회가 500페이지를 넘겼다).
    tokenParam = 'nextToken'
  ): Promise<T[]> {
    const items: T[] = []
    // 첫 페이지 토큰. 정산 API 는 token 파라미터가 없으면 400 "token cannot be null" 이라
    // 빈 문자열로 시작해야 한다. nextToken 계열은 빈 값이 무시되므로 그대로 둬도 안전하다.
    let nextToken: string | undefined = ''
    let page = 0

    do {
      page += 1
      if (page > maxPages) {
        throw new Error(
          `쿠팡 API 페이징이 maxPages(${maxPages})를 초과했습니다: ${path} — nextToken 이 계속 남아 있습니다`
        )
      }
      const res = await this.get<R>(path, { ...query, [tokenParam]: nextToken })
      const { items: pageItems, nextToken: next } = pick(res)
      items.push(...pageItems)
      nextToken = next ?? undefined
    } while (nextToken)

    return items
  }
}
