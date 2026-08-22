/**
 * SSRF 방지 HTML fetcher — 사용자가 입력한 상품 상세페이지 URL을 안전하게 가져온다.
 *
 * 이 저장소에는 기존에 이런 가드가 없었다. 여기서 새로 작성한다.
 *
 * 방어 순서(각 리다이렉트 홉마다 전부 재실행):
 * 1) URL 파싱, 2) scheme 화이트리스트, 3) userinfo 금지, 4) 포트 화이트리스트,
 * 5) DNS 조회 후 모든 주소를 사설/예약대역 차단목록과 대조, 6) redirect:'manual'로 직접
 * fetch하며 302 등은 수동으로 따라가 매 홉마다 1~5를 재검증, 7) HTTP status 검증,
 * 8) content-type 화이트리스트, 9) 본문은 스트리밍으로 읽으며 2MB 상한에서 절단.
 *
 * ⚠️ 수용한 잔여 위험(DNS Rebinding TOCTOU):
 * 5단계에서 조회한 주소와 6단계에서 fetch()가 실제로 연결하는 주소가 다를 수 있다.
 * 완전한 차단을 위해서는 undici의 `Agent({ connect })`로 소켓 연결 시점에 주소를 재검증하는
 * 방식(TLS SNI를 위한 servername은 유지)이 필요하다. 이번 범위에서는 채택하지 않았다 —
 * 호출자가 인증된 Space 멤버이고, 응답 본문이 사용자에게 그대로 노출되지 않고 AI 모델에만
 * 전달되기 때문이다. 후속 작업으로 등록해둔다.
 */

import dns from 'node:dns'

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

/** content-type 헤더에서 charset을 추출한다. 없으면 null. */
function extractCharset(contentType: string): string | null {
  const match = /charset=([^;]+)/i.exec(contentType)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null
}

/**
 * 사용자가 입력한 상품 상세페이지 URL을 SSRF 가드를 거쳐 안전하게 가져온다.
 * 리다이렉트는 최대 3홉까지 수동으로 따라가며, 매 홉마다 전체 검증을 재실행한다.
 */
export async function safeFetchHtml(rawUrl: string): Promise<{
  finalUrl: string
  html: string
  truncated: boolean
}> {
  let currentUrl = await validateHop(rawUrl)

  for (let redirectCount = 0; ; redirectCount++) {
    let res: Response
    try {
      res = await fetch(currentUrl.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        // AbortSignal.timeout()은 AbortError가 아니라 TimeoutError를 던진다(Node 18+).
        throw new SafeFetchError('TIMEOUT', `요청 시간이 초과되었습니다: ${currentUrl.toString()}`)
      }
      throw new SafeFetchError('FETCH_FAILED', `요청에 실패했습니다: ${currentUrl.toString()}`)
    }

    if (res.status >= 300 && res.status < 400) {
      if (redirectCount + 1 >= MAX_REDIRECTS) {
        throw new SafeFetchError(
          'TOO_MANY_REDIRECTS',
          `리다이렉트 횟수가 한도(${MAX_REDIRECTS})를 초과했습니다.`
        )
      }
      const location = res.headers.get('location')
      if (!location) {
        throw new SafeFetchError(
          'HTTP_ERROR',
          `리다이렉트 응답에 Location 헤더가 없습니다: ${res.status}`
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

    if (res.status < 200 || res.status >= 300) {
      throw new SafeFetchError('HTTP_ERROR', `예상치 못한 HTTP 상태 코드입니다: ${res.status}`)
    }

    const contentType = res.headers.get('content-type')
    if (
      !contentType ||
      !ALLOWED_CONTENT_TYPES.some((allowed) => contentType.toLowerCase().startsWith(allowed))
    ) {
      throw new SafeFetchError(
        'CONTENT_TYPE_NOT_ALLOWED',
        `허용되지 않은 content-type입니다: ${contentType ?? '(없음)'}`
      )
    }

    if (!res.body) {
      throw new SafeFetchError('FETCH_FAILED', '응답 본문이 없습니다.')
    }

    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    let truncated = false

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue

        if (totalBytes + value.byteLength > MAX_BYTES) {
          const remaining = MAX_BYTES - totalBytes
          if (remaining > 0) chunks.push(value.subarray(0, remaining))
          totalBytes = MAX_BYTES
          truncated = true
          await reader.cancel()
          break
        }

        chunks.push(value)
        totalBytes += value.byteLength
      }
    } catch {
      throw new SafeFetchError('FETCH_FAILED', '응답 본문을 읽는 중 오류가 발생했습니다.')
    }

    const merged = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    const charset = extractCharset(contentType)
    let html: string
    try {
      html = new TextDecoder(charset ?? 'utf-8').decode(merged)
    } catch {
      html = new TextDecoder('utf-8').decode(merged)
    }

    return {
      finalUrl: currentUrl.toString(),
      html,
      truncated,
    }
  }
}
