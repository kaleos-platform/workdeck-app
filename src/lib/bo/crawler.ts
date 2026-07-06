import dns from 'dns/promises'
import { isIP, isIPv4, isIPv6 } from 'net'

// ─── 오류 타입 ─────────────────────────────────────────────────────────────────

export type CrawlErrorCode = 'INVALID_URL' | 'BLOCKED_HOST' | 'FETCH_FAILED' | 'EMPTY_CONTENT'

export class CrawlError extends Error {
  constructor(
    public readonly code: CrawlErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CrawlError'
  }
}

// ─── SSRF 방어 ────────────────────────────────────────────────────────────────

// IPv4 주소를 숫자로 변환
function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0
}

// 사설·루프백·링크로컬 IPv4 대역 차단
function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  const ranges: [string, number][] = [
    ['127.0.0.0', 8], // 루프백
    ['10.0.0.0', 8], // 사설망
    ['172.16.0.0', 12], // 사설망
    ['192.168.0.0', 16], // 사설망
    ['169.254.0.0', 16], // 링크로컬 (AWS 메타데이터 포함)
    ['100.64.0.0', 10], // Shared Address Space (RFC 6598)
    ['0.0.0.0', 8], // "이 네트워크"
    ['192.0.0.0', 24], // IETF Protocol Assignments
    ['198.18.0.0', 15], // 벤치마크 테스트
    ['198.51.100.0', 24], // Documentation
    ['203.0.113.0', 24], // Documentation
    ['240.0.0.0', 4], // 미래 예약
    ['255.255.255.255', 32], // 브로드캐스트
  ]
  for (const [base, prefix] of ranges) {
    const mask = prefix === 0 ? 0 : ~((1 << (32 - prefix)) - 1) >>> 0
    if ((n & mask) === (ipv4ToInt(base) & mask)) return true
  }
  return false
}

// 사설·루프백·링크로컬 IPv6 대역 차단
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  // 루프백
  if (lower === '::1') return true
  // 로컬 유니캐스트 fc00::/7 (fc00:: ~ fdff::)
  if (/^f[cd]/i.test(lower)) return true
  // 링크로컬 fe80::/10
  if (/^fe[89ab]/i.test(lower)) return true
  // IPv4-mapped ::ffff:x.x.x.x
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  // 멀티캐스트 ff00::/8
  if (/^ff/i.test(lower)) return true
  return false
}

export function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip)
  if (isIPv6(ip)) return isPrivateIPv6(ip)
  return true // 알 수 없는 형식은 차단
}

// 호스트명을 DNS로 조회해 모든 IP가 공개망인지 확인
async function assertPublicHost(hostname: string): Promise<void> {
  // 이미 IP 리터럴이면 바로 검사
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new CrawlError('BLOCKED_HOST', `차단된 IP 주소입니다: ${hostname}`)
    }
    return
  }

  // DNS A + AAAA 조회 — resolve는 모든 레코드를 반환
  const [v4Results, v6Results] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ])

  const ips: string[] = []
  if (v4Results.status === 'fulfilled') ips.push(...v4Results.value)
  if (v6Results.status === 'fulfilled') ips.push(...v6Results.value)

  if (ips.length === 0) {
    throw new CrawlError('BLOCKED_HOST', `호스트를 확인할 수 없습니다: ${hostname}`)
  }

  for (const ip of ips) {
    if (isBlockedIp(ip)) {
      throw new CrawlError('BLOCKED_HOST', `차단된 호스트입니다: ${hostname} → ${ip}`)
    }
  }
}

// ─── HTML 처리 ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  // script / style / nav / header / footer / aside 태그와 내용 제거
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    // HTML 태그 제거
    .replace(/<[^>]+>/g, ' ')
    // HTML 엔티티 기본 변환
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // 공백 정규화
    .replace(/\s+/g, ' ')
    .trim()

  return text
}

// ─── 크롤러 ──────────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000
const MAX_TEXT_CHARS = 20_000
const MAX_REDIRECTS = 5

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export type CrawlResult = {
  text: string
  fetchedAt: Date
}

// 리다이렉트를 직접 처리해 SSRF 방어 (Location 헤더도 검증)
async function fetchWithSsrfGuard(url: string, remainingRedirects: number): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new CrawlError('INVALID_URL', '올바르지 않은 URL입니다')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlError('INVALID_URL', 'http/https URL만 허용합니다')
  }

  await assertPublicHost(parsed.hostname)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
  } catch (err) {
    throw new CrawlError(
      'FETCH_FAILED',
      `가져오기 실패: ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    clearTimeout(timer)
  }

  // 3xx 리다이렉트 처리
  if (res.status >= 300 && res.status < 400) {
    if (remainingRedirects <= 0) {
      throw new CrawlError('FETCH_FAILED', '리다이렉트 한도를 초과했습니다')
    }
    const location = res.headers.get('location')
    if (!location) {
      throw new CrawlError('FETCH_FAILED', '리다이렉트 Location 헤더가 없습니다')
    }
    // 상대 경로 → 절대 경로 변환
    const nextUrl = new URL(location, url).toString()
    return fetchWithSsrfGuard(nextUrl, remainingRedirects - 1)
  }

  return res
}

export async function crawlHomepage(url: string): Promise<CrawlResult> {
  // 1. URL 유효성 검사 (scheme 먼저)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new CrawlError('INVALID_URL', '올바르지 않은 URL입니다')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CrawlError('INVALID_URL', 'http/https URL만 허용합니다')
  }

  // 2. SSRF 가드 + fetch (리다이렉트 직접 처리)
  const res = await fetchWithSsrfGuard(url, MAX_REDIRECTS)

  if (!res.ok) {
    throw new CrawlError('FETCH_FAILED', `HTTP ${res.status} 응답`)
  }

  // 3. 본문 처리
  let html: string
  try {
    html = await res.text()
  } catch (err) {
    throw new CrawlError(
      'FETCH_FAILED',
      `응답 읽기 실패: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const text = stripHtml(html).slice(0, MAX_TEXT_CHARS)

  if (!text.trim()) {
    throw new CrawlError('EMPTY_CONTENT', '페이지에서 텍스트를 추출하지 못했습니다')
  }

  return { text, fetchedAt: new Date() }
}
