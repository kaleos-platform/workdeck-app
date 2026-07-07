// @jest-environment node
import { isBlockedIp, CrawlError } from '../crawler'

describe('isBlockedIp — IPv4 사설/루프백/링크로컬 차단', () => {
  const blocked = [
    '127.0.0.1', // 루프백
    '127.255.255.255', // 루프백 대역 끝
    '10.0.0.1', // 사설망 10/8
    '10.255.255.255',
    '172.16.0.1', // 사설망 172.16/12
    '172.31.255.255',
    '192.168.0.1', // 사설망 192.168/16
    '192.168.255.255',
    '169.254.0.1', // 링크로컬 (AWS 메타데이터)
    '169.254.169.254', // AWS EC2 인스턴스 메타데이터
    '0.0.0.1', // "이 네트워크"
    '100.64.0.1', // Shared Address Space
  ]

  const allowed = [
    '8.8.8.8', // Google DNS
    '1.1.1.1', // Cloudflare DNS
    '93.184.216.34', // example.com
    '151.101.1.1', // Fastly CDN
  ]

  test.each(blocked)('차단: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  test.each(allowed)('허용: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('isBlockedIp — IPv6 사설/루프백/링크로컬 차단', () => {
  const blocked = [
    '::1', // IPv6 루프백
    'fc00::1', // 고유 로컬 유니캐스트
    'fd00::1', // 고유 로컬 유니캐스트 (fd)
    'fe80::1', // 링크로컬
    'fe80::cafe:babe',
    '::ffff:127.0.0.1', // IPv4-mapped 루프백
    '::ffff:10.0.0.1', // IPv4-mapped 사설망
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254', // IPv4-mapped AWS 메타데이터
    'ff02::1', // 멀티캐스트
  ]

  const allowed = [
    '2001:4860:4860::8888', // Google Public DNS (IPv6)
    '2606:4700:4700::1111', // Cloudflare DNS (IPv6)
  ]

  test.each(blocked)('차단: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  test.each(allowed)('허용: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('CrawlError 타입 확인', () => {
  test('code와 message를 올바르게 보관', () => {
    const err = new CrawlError('INVALID_URL', '올바르지 않은 URL')
    expect(err.code).toBe('INVALID_URL')
    expect(err.message).toBe('올바르지 않은 URL')
    expect(err.name).toBe('CrawlError')
    expect(err instanceof Error).toBe(true)
    expect(err instanceof CrawlError).toBe(true)
  })

  test('모든 에러 코드 타입 허용', () => {
    const codes = ['INVALID_URL', 'BLOCKED_HOST', 'FETCH_FAILED', 'EMPTY_CONTENT'] as const
    for (const code of codes) {
      const err = new CrawlError(code, 'test')
      expect(err.code).toBe(code)
    }
  })
})
