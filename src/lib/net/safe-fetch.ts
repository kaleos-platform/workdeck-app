/**
 * SSRF 방지 HTML fetcher — 사용자가 입력한 상품 상세페이지 URL을 안전하게 가져온다.
 *
 * 이 저장소에는 기존에 이런 가드가 없었다. 여기서 새로 작성한다.
 *
 * 방어 순서(각 리다이렉트 홉마다 전부 재실행):
 * 1) URL 파싱, 2) scheme 화이트리스트, 3) userinfo 금지, 4) 포트 화이트리스트,
 * 5) DNS 조회 후 모든 주소를 사설/예약대역 차단목록과 대조(사전 검사 — 빠른 실패와
 * 명확한 PRIVATE_ADDRESS 코드를 위해 남겨둔다), 6) node:http/https로 직접 요청하며
 * 3xx는 자동으로 따라가지 않고 수동으로 Location을 다시 1~5부터 검증, 7) 소켓 연결
 * 직전 호출되는 lookup 훅에서 실제 연결 대상 주소를 5단계와 동일한 기준으로 재검증,
 * 8) HTTP status 검증, 9) content-type 화이트리스트, 10) 본문은 스트리밍으로 읽으며
 * 2MB 상한에서 절단.
 *
 * ⚠️ DNS Rebinding TOCTOU — 닫힘:
 * 이전에는 5단계에서 조회한 주소와 fetch()가 실제로 연결하는 주소가 다를 수 있었다
 * (공격자가 짧은 TTL로 최초 조회엔 공인 IP를, 실제 연결 시엔 169.254.169.254 등을
 * 주는 방식). 지금은 7단계로 이 구멍을 닫았다: node:http/https의 `lookup` 옵션은
 * 소켓 연결 직전에 호출되고, Node는 그 콜백이 반환한 주소로 그대로 연결한다(별도
 * 재조회 없음) — 따라서 검증 시점과 연결 시점의 주소가 항상 동일하다. 이 lookup 훅은
 * hostname을 IP로 치환하지 않고 "연결을 허용할 주소"만 제약하므로, TLS servername
 * (SNI)은 원본 호스트명으로 구조적으로 보존된다 — 별도로 손으로 관리할 필요가 없다.
 * 이 프로젝트의 undici는 Node 내장이 아니어서(런타임에 `require('undici')`가
 * 실패함을 확인) `Agent({ connect })` 방식 대신 이 방식을 채택했다.
 *
 * 남은 잔여 위험: OS/로컬 리졸버 자체가 오염되어 있는 경우(캐시 포이즈닝 등)는
 * 이 계층에서 막을 수 없다 — 신뢰할 수 있는 DNS 인프라를 전제한다.
 *
 * ⚠️ 한 hop에 dns.promises.lookup이 두 번(5단계 사전 검사 + 7단계 connector) 불리는
 * 것은 중복이 아니라 TOCTOU를 닫는 핵심이다. "같은 호스트를 왜 두 번 조회하냐"며
 * 7단계를 5단계 결과 재사용으로 "최적화"하면 이 파일이 막으려는 구멍이 그대로 다시
 * 열린다 — 절대 합치지 말 것.
 */

import dns from 'node:dns'
import zlib from 'node:zlib'
import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'

export type SafeFetchErrorCode =
  | 'INVALID_URL'
  | 'SCHEME_NOT_ALLOWED'
  | 'USERINFO_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED'
  | 'PRIVATE_ADDRESS'
  | 'DNS_FAILED'
  | 'TOO_MANY_REDIRECTS'
  | 'CONTENT_TYPE_NOT_ALLOWED'
  | 'TIMEOUT'
  | 'FETCH_FAILED'
  | 'HTTP_ERROR'
  | 'TOO_LARGE'

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode

  constructor(code: SafeFetchErrorCode, message: string) {
    super(message)
    this.name = 'SafeFetchError'
    this.code = code
  }
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:'])
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443])
const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']
const DEFAULT_PORTS: Record<string, number> = { 'http:': 80, 'https:': 443 }
const MAX_REDIRECTS = 3
const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 8000
const USER_AGENT = 'WorkdeckBot/1.0 (+https://workdeck.work)'

// ─── safeFetchBinary 전용 상수 ────────────────────────────────────────────────
// 상세 이미지는 HTML 문서보다 커질 수 있어 상한·타임아웃을 별도로 둔다.
const ALLOWED_IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_BINARY_BYTES = 5 * 1024 * 1024
const BINARY_TIMEOUT_MS = 15000

/** IPv4 문자열을 uint32로 변환한다. 실패 시 null. */
function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n < 0 || n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0
}

/** uint32 IPv4 주소가 base/prefixLen CIDR에 속하는지 마스크 비교로 판정한다. */
function ipv4InCidr(addr: number, base: string, prefixLen: number): boolean {
  const baseNum = ipv4ToUint32(base)
  if (baseNum === null) return false
  if (prefixLen === 0) return true
  const mask = prefixLen === 32 ? 0xffffffff : (0xffffffff << (32 - prefixLen)) >>> 0
  return (addr & mask) === (baseNum & mask)
}

const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function isBlockedIpv4(ip: string): boolean {
  const addr = ipv4ToUint32(ip)
  if (addr === null) return true // 파싱 불가 주소는 안전하게 차단
  return IPV4_BLOCKED_RANGES.some(([base, prefixLen]) => ipv4InCidr(addr, base, prefixLen))
}

/** IPv6 주소를 8개의 16bit 그룹(hextet) 배열로 정규화한다. 실패 시 null. */
function expandIpv6(ip: string): number[] | null {
  let addr = ip.trim().toLowerCase()
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1)

  // IPv4-mapped 표기(끝부분이 a.b.c.d)를 hex 그룹으로 치환
  const lastColon = addr.lastIndexOf(':')
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes('.')) {
    const v4 = addr.slice(lastColon + 1)
    const v4num = ipv4ToUint32(v4)
    if (v4num === null) return null
    const hi = (v4num >>> 16) & 0xffff
    const lo = v4num & 0xffff
    addr = addr.slice(0, lastColon + 1) + hi.toString(16) + ':' + lo.toString(16)
  }

  const [head, tail] = addr.includes('::') ? addr.split('::') : [addr, undefined]
  const headParts = head.length ? head.split(':') : []
  const tailParts = tail !== undefined && tail.length ? tail.split(':') : []

  if (tail === undefined) {
    if (headParts.length !== 8) return null
  } else {
    const missing = 8 - headParts.length - tailParts.length
    if (missing < 0) return null
    for (let i = 0; i < missing; i++) headParts.push('0')
    headParts.push(...tailParts)
  }

  if (headParts.length !== 8) return null
  const groups: number[] = []
  for (const part of headParts) {
    if (!/^[0-9a-f]{0,4}$/.test(part)) return null
    groups.push(part === '' ? 0 : parseInt(part, 16))
  }
  return groups
}

function isBlockedIpv6(groups: number[]): boolean {
  const isZero = groups.every((g) => g === 0)
  if (isZero) return true // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1

  // IPv4-mapped ::ffff:a.b.c.d → 언맵 후 IPv4 규칙 재적용
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6]
    const lo = groups[7]
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
    return isBlockedIpv4(v4)
  }

  const first = groups[0]
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 (ULA)
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 (link-local)
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 (multicast)

  return false
}

/**
 * IPv4/IPv6 주소가 사설망·루프백·링크로컬 등 차단 대역에 속하는지 판정한다.
 * family: 4 또는 6 (node:dns lookup 결과의 family 값).
 */
export function isBlockedAddress(ip: string, family: number): boolean {
  if (family === 4) {
    return isBlockedIpv4(ip)
  }
  if (family === 6) {
    const groups = expandIpv6(ip)
    if (groups === null) return true // 파싱 불가는 안전하게 차단
    return isBlockedIpv6(groups)
  }
  return true
}

/** 호스트명이 이미 IP 리터럴이면 [family, address]를, 아니면 null을 반환한다. */
function asIpLiteral(hostname: string): { family: number; address: string } | null {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (ipv4ToUint32(bare) !== null) return { family: 4, address: bare }
  if (expandIpv6(bare) !== null && bare.includes(':')) return { family: 6, address: bare }
  return null
}

/** URL을 파싱하고 scheme·userinfo·port를 검증한다. 통과 시 URL 객체를 반환. */
function validateUrlStructure(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SafeFetchError('INVALID_URL', `URL을 파싱할 수 없습니다: ${rawUrl}`)
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SafeFetchError('SCHEME_NOT_ALLOWED', `허용되지 않은 scheme입니다: ${url.protocol}`)
  }

  if (url.username || url.password) {
    throw new SafeFetchError('USERINFO_NOT_ALLOWED', 'URL에 사용자 인증정보를 포함할 수 없습니다.')
  }

  const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol]
  if (!port || !ALLOWED_PORTS.has(port)) {
    throw new SafeFetchError('PORT_NOT_ALLOWED', `허용되지 않은 포트입니다: ${port}`)
  }

  return url
}

/** 호스트명을 DNS로 조회하고, 모든 주소가 차단 대역이 아닌지 검증한다. */
async function validateHostAddresses(hostname: string): Promise<void> {
  const literal = asIpLiteral(hostname)
  if (literal) {
    if (isBlockedAddress(literal.address, literal.family)) {
      throw new SafeFetchError(
        'PRIVATE_ADDRESS',
        `사설/예약 대역 주소는 허용되지 않습니다: ${hostname}`
      )
    }
    return
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await dns.promises.lookup(hostname, { all: true })
  } catch {
    throw new SafeFetchError('DNS_FAILED', `DNS 조회에 실패했습니다: ${hostname}`)
  }

  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new SafeFetchError(
        'PRIVATE_ADDRESS',
        `사설/예약 대역 주소로 확인되어 차단합니다: ${hostname} → ${address}`
      )
    }
  }
}

/** 단일 URL(리다이렉트 아닌 최초 요청 포함)에 대해 구조 검증 + DNS 검증을 수행한다. */
async function validateHop(rawUrl: string): Promise<URL> {
  const url = validateUrlStructure(rawUrl)
  await validateHostAddresses(url.hostname)
  return url
}

/**
 * 서버가 identity 요청을 무시하고 압축해 보낸 경우에만 쓰이는 방어적 해제기.
 * gzip/deflate/br 은 node:zlib 내장 기능이라 신규 의존성이 없다.
 */
function decompressBody(input: Uint8Array, encoding: string): Uint8Array {
  const buf = Buffer.from(input)
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.gunzipSync(buf)
  if (encoding === 'deflate') return zlib.inflateSync(buf)
  if (encoding === 'br') return zlib.brotliDecompressSync(buf)
  throw new Error(`지원하지 않는 content-encoding: ${encoding}`)
}

/**
 * http(s).request의 `lookup` 옵션 — 소켓 연결 직전에 호출된다.
 * dns.promises.lookup으로 재조회한 뒤 isBlockedAddress로 재검증하고, 하나라도
 * 차단 대역이면 전체를 거부한다(사전 DNS 검사와 동일한 기준). 이 콜백이 넘긴
 * 주소로 Node가 그대로 연결하므로(재조회 없음) 검증·연결 시점이 항상 일치한다.
 * hostname을 IP로 바꿔치기하지 않으므로 TLS servername(SNI)은 그대로 보존된다.
 */
const secureLookup: LookupFunction = (hostname, options, callback) => {
  const wantsAll = typeof options === 'object' && options !== null && options.all === true

  dns.promises.lookup(hostname, { all: true }).then(
    (addresses) => {
      const blocked = addresses.find(({ address, family }) => isBlockedAddress(address, family))
      if (blocked) {
        const err = new Error(
          `사설/예약 대역 주소로 확인되어 차단합니다: ${hostname} → ${blocked.address}`
        ) as NodeJS.ErrnoException
        err.code = 'EPRIVATEADDR'
        callback(err, '')
        return
      }
      if (wantsAll) {
        callback(null, addresses)
      } else {
        callback(null, addresses[0].address, addresses[0].family)
      }
    },
    (err: unknown) => {
      callback(err instanceof Error ? err : new Error(String(err)), '')
    }
  )
}

/** requestOnce()가 반환하는 hop 하나의 결과. 본문을 다 읽었든 중간에 실패했든, 이 hop을 더 쓰지 않게 되는 시점에 반드시 clearHopTimeout()을 호출해야 한다. */
interface HopResult {
  res: http.IncomingMessage
  /** hop의 타이머를 해제한다. 리다이렉트 continue·상태코드/컨텐츠타입 거부·본문 완독·본문 read 에러 등 모든 종료 경로에서 호출한다. */
  clearHopTimeout: () => void
  /** 본문 read 중 에러가 발생했을 때, 그 에러가 타임아웃 때문이었는지 판별한다. */
  didTimeOut: () => boolean
}

/**
 * http(s).request 하나를 보내고 응답 헤더 수신 시 resolve한다.
 * timeoutMs는 소켓 연결·헤더 수신뿐 아니라 본문을 다 읽을 때까지 hop 전체를 감싼다 —
 * clearHopTimeout()을 호출하기 전까지는 타이머가 살아있어 본문을 천천히 흘려보내는
 * 방식으로 시간을 버는 것도 차단한다.
 */
function requestOnce(url: URL, timeoutMs: number, acceptHeader: string): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const transport = isHttps ? https : http
    const port = url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol]

    const options: https.RequestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      lookup: secureLookup,
      headers: {
        'user-agent': USER_AGENT,
        accept: acceptHeader,
        // 헤더를 생략하면 HTTP 규약상 "어떤 인코딩이든 수용"이 되어 서버가 gzip을 줄 수 있다.
        // http.request는 fetch/undici와 달리 투명 압축해제를 하지 않으므로 그대로 두면
        // TextDecoder/이미지 디코더가 압축 바이트를 그대로 해독해 깨진 결과가 나온다.
        // identity를 명시한다.
        'accept-encoding': 'identity',
      },
    }
    if (isHttps) {
      // hostname을 IP로 치환하지 않으므로 servername은 항상 원본 호스트명과 같다.
      // 명시적으로 지정해 SNI가 흔들리지 않게 고정한다.
      options.servername = url.hostname
    }

    let currentRes: http.IncomingMessage | undefined
    let timedOut = false

    // req는 timer 클로저가 참조하지만, timer는 이 tick의 동기 실행이 끝난 뒤(timeoutMs 후)에만
    // 발화하므로 req가 아래에서 바로 이어서 할당되면 TDZ 문제 없이 안전하다.
    const req: http.ClientRequest = transport.request(options, (res) => {
      currentRes = res
      // res.resume() 후 draining 중(HTTP_ERROR/CONTENT_TYPE_NOT_ALLOWED)이거나 promise가
      // 이미 settle된 뒤에 소켓이 끊기면 res가 'error'를 낼 수 있다. 리스너가 없으면
      // Node에서 uncaughtException으로 터진다 — 그 시점엔 더 할 수 있는 일이 없으므로 삼킨다.
      res.on('error', () => {})
      resolve({
        res,
        clearHopTimeout: () => clearTimeout(timer),
        didTimeOut: () => timedOut,
      })
    })

    const timer = setTimeout(() => {
      timedOut = true
      const timeoutError = new SafeFetchError(
        'TIMEOUT',
        `요청 시간이 초과되었습니다: ${url.toString()}`
      )
      ;(currentRes ?? req).destroy(timeoutError)
    }, timeoutMs)

    req.on('error', (err) => {
      clearTimeout(timer)
      if (err instanceof SafeFetchError) {
        reject(err)
        return
      }
      if ((err as NodeJS.ErrnoException).code === 'EPRIVATEADDR') {
        reject(new SafeFetchError('PRIVATE_ADDRESS', err.message))
        return
      }
      reject(new SafeFetchError('FETCH_FAILED', `요청에 실패했습니다: ${url.toString()}`))
    })

    req.end()
  })
}

/** content-type 헤더에서 charset을 추출한다. 없으면 null. */
function extractCharset(contentType: string): string | null {
  const match = /charset=([^;]+)/i.exec(contentType)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
}

interface GuardedFetchOptions {
  /** hop 전체(연결·헤더·본문 read)를 감싸는 타임아웃. */
  timeoutMs: number
  /** 본문 상한(바이트). 압축 해제 후 크기에도 동일하게 적용한다. */
  maxBytes: number
  /** Accept 헤더 값. */
  acceptHeader: string
  /** content-type 화이트리스트(소문자 startsWith 매칭). */
  allowedContentTypes: readonly string[]
  /**
   * 상한 초과 시 동작.
   * 'truncate' — 상한까지만 자르고 truncated:true 로 계속 진행(HTML 텍스트용, 부분 텍스트도 쓸모가 있다).
   * 'reject'   — TOO_LARGE 로 즉시 거부(바이너리용, 잘린 이미지는 모델에 넣어도 무의미하고 조용한 손상이다).
   */
  overflow: 'truncate' | 'reject'
}

interface GuardedFetchResult {
  finalUrl: string
  /** 원본 content-type 헤더 값(charset 파라미터 포함, 있다면). */
  contentType: string
  body: Uint8Array
  truncated: boolean
}

/**
 * safeFetchHtml과 safeFetchBinary가 공유하는 SSRF 가드 + 리다이렉트 추적 + 본문 수집 코어.
 * 두 공개 함수는 이 함수 위에 얇게 서 있다 — 가드 로직을 복제하지 않는다(복제하면 한쪽만
 * 고쳐지는 순간 구멍이 남는다).
 * 리다이렉트는 최대 3홉까지 수동으로 따라가며, 매 홉마다 전체 검증(validateHop)을 재실행한다.
 */
async function guardedFetch(
  rawUrl: string,
  opts: GuardedFetchOptions
): Promise<GuardedFetchResult> {
  let currentUrl = await validateHop(rawUrl)

  for (let redirectCount = 0; ; redirectCount++) {
    let hop: HopResult
    try {
      hop = await requestOnce(currentUrl, opts.timeoutMs, opts.acceptHeader)
    } catch (err) {
      if (err instanceof SafeFetchError) throw err
      throw new SafeFetchError('FETCH_FAILED', `요청에 실패했습니다: ${currentUrl.toString()}`)
    }
    const { res, clearHopTimeout, didTimeOut } = hop

    const status = res.statusCode ?? 0
    const rawContentType = res.headers['content-type']
    const contentType = Array.isArray(rawContentType)
      ? (rawContentType[0] ?? null)
      : (rawContentType ?? null)

    if (status >= 300 && status < 400) {
      res.resume() // 리다이렉트 본문은 읽지 않고 소켓만 비운다.
      clearHopTimeout()

      if (redirectCount + 1 >= MAX_REDIRECTS) {
        throw new SafeFetchError(
          'TOO_MANY_REDIRECTS',
          `리다이렉트 횟수가 한도(${MAX_REDIRECTS})를 초과했습니다.`
        )
      }
      const location = res.headers.location
      if (!location) {
        throw new SafeFetchError(
          'HTTP_ERROR',
          `리다이렉트 응답에 Location 헤더가 없습니다: ${status}`
        )
      }
      let nextUrl: URL
      try {
        nextUrl = new URL(location, currentUrl)
      } catch {
        throw new SafeFetchError(
          'INVALID_URL',
          `리다이렉트 대상 URL을 파싱할 수 없습니다: ${location}`
        )
      }
      currentUrl = await validateHop(nextUrl.toString())
      continue
    }

    if (status < 200 || status >= 300) {
      res.resume()
      clearHopTimeout()
      throw new SafeFetchError('HTTP_ERROR', `예상치 못한 HTTP 상태 코드입니다: ${status}`)
    }

    if (
      !contentType ||
      !opts.allowedContentTypes.some((allowed) => contentType.toLowerCase().startsWith(allowed))
    ) {
      res.resume()
      clearHopTimeout()
      throw new SafeFetchError(
        'CONTENT_TYPE_NOT_ALLOWED',
        `허용되지 않은 content-type입니다: ${contentType ?? '(없음)'}`
      )
    }

    const chunks: Uint8Array[] = []
    let totalBytes = 0
    let truncated = false

    try {
      for await (const chunk of res as AsyncIterable<Buffer>) {
        if (totalBytes + chunk.byteLength > opts.maxBytes) {
          if (opts.overflow === 'reject') {
            res.destroy()
            throw new SafeFetchError(
              'TOO_LARGE',
              `응답 본문이 상한(${opts.maxBytes} bytes)을 초과했습니다: ${currentUrl.toString()}`
            )
          }
          const remaining = opts.maxBytes - totalBytes
          if (remaining > 0) chunks.push(chunk.subarray(0, remaining))
          totalBytes = opts.maxBytes
          truncated = true
          res.destroy()
          break
        }

        chunks.push(chunk)
        totalBytes += chunk.byteLength
      }
    } catch (err) {
      // TOO_LARGE(reject 모드)는 위에서 명시적으로 던진 것이므로 타임아웃 판별 없이 그대로 전파한다.
      if (err instanceof SafeFetchError) {
        clearHopTimeout()
        throw err
      }
      // 타이머가 본문 read 도중 발화해 res.destroy()로 끊긴 경우와, 순수 스트림 오류를 구분한다.
      const timedOut = didTimeOut()
      clearHopTimeout()
      if (timedOut) {
        throw new SafeFetchError('TIMEOUT', `요청 시간이 초과되었습니다: ${currentUrl.toString()}`)
      }
      throw new SafeFetchError('FETCH_FAILED', '응답 본문을 읽는 중 오류가 발생했습니다.')
    }
    clearHopTimeout()

    const merged = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    // identity를 요청했는데도 압축해 보내는 서버가 있다. 압축 바이트를 그대로 해독하면
    // 조용히 깨진 결과가 되므로 해제한다. 해제 결과에도 동일한 크기 상한을 적용한다
    // — 압축률이 높은 응답(zip bomb)이 상한을 우회하는 통로가 되면 안 된다.
    let body: Uint8Array = merged
    const rawEncoding = res.headers['content-encoding']
    const encoding = (Array.isArray(rawEncoding) ? (rawEncoding[0] ?? '') : (rawEncoding ?? ''))
      .trim()
      .toLowerCase()
    if (encoding && encoding !== 'identity') {
      try {
        body = decompressBody(merged, encoding)
      } catch {
        throw new SafeFetchError('FETCH_FAILED', `응답 압축을 해제할 수 없습니다: ${encoding}`)
      }
      if (body.byteLength > opts.maxBytes) {
        if (opts.overflow === 'reject') {
          throw new SafeFetchError(
            'TOO_LARGE',
            `응답 본문이 상한(${opts.maxBytes} bytes)을 초과했습니다: ${currentUrl.toString()}`
          )
        }
        body = body.subarray(0, opts.maxBytes)
        truncated = true
      }
    }

    return {
      finalUrl: currentUrl.toString(),
      contentType,
      body,
      truncated,
    }
  }
}

/**
 * 사용자가 입력한 상품 상세페이지 URL을 SSRF 가드를 거쳐 안전하게 가져온다.
 */
export async function safeFetchHtml(rawUrl: string): Promise<{
  finalUrl: string
  html: string
  truncated: boolean
}> {
  const { finalUrl, contentType, body, truncated } = await guardedFetch(rawUrl, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    acceptHeader: 'text/html,application/xhtml+xml',
    allowedContentTypes: ALLOWED_CONTENT_TYPES,
    overflow: 'truncate',
  })

  const charset = extractCharset(contentType)
  let html: string
  try {
    html = new TextDecoder(charset ?? 'utf-8').decode(body)
  } catch {
    html = new TextDecoder('utf-8').decode(body)
  }

  return { finalUrl, html, truncated }
}

/**
 * HTML에서 뽑아낸 상세 이미지 URL을 SSRF 가드를 거쳐 안전하게 내려받는다.
 * safeFetchHtml과 동일한 가드(scheme/userinfo/port/DNS 사전검사+lookup 훅 재검증/리다이렉트
 * 수동추적)를 guardedFetch로 공유한다 — 이미지 URL도 사용자가 입력한 페이지의 HTML에서
 * 뽑아낸, 즉 신뢰할 수 없는 값이기 때문이다(공격자가 자기 페이지에
 * `<img ec-data-src="http://169.254.169.254/...">` 를 심으면 이 함수가 그걸 그대로
 * 가져오게 될 수 있다).
 * 상한을 넘으면 자르지 않고 TOO_LARGE로 거부한다 — 잘린 이미지는 모델에 넣어도 무의미하다.
 */
export async function safeFetchBinary(
  rawUrl: string,
  opts?: { maxBytes?: number; allowedMimePrefixes?: readonly string[] }
): Promise<{ finalUrl: string; bytes: Buffer; mimeType: string }> {
  const maxBytes = opts?.maxBytes ?? MAX_BINARY_BYTES
  const allowedContentTypes = opts?.allowedMimePrefixes ?? ALLOWED_IMAGE_CONTENT_TYPES

  const { finalUrl, contentType, body } = await guardedFetch(rawUrl, {
    timeoutMs: BINARY_TIMEOUT_MS,
    maxBytes,
    acceptHeader: allowedContentTypes.join(','),
    allowedContentTypes,
    overflow: 'reject',
  })

  const mimeType = contentType.split(';')[0]?.trim().toLowerCase() ?? contentType.toLowerCase()

  return { finalUrl, bytes: Buffer.from(body), mimeType }
}
