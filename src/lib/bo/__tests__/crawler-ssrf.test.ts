// @jest-environment node
// H2 SSRF 핀 고정 검증 — dns/promises + node:http 를 모킹해 실 네트워크 없이 테스트

import { EventEmitter } from 'events'
import type { IncomingMessage } from 'http'

// ─── 모듈 모킹 (jest.mock 은 호이스팅됨) ──────────────────────────────────────
// 팩토리 안에서 변수 참조 금지(TOCTOU) — jest.fn() 을 팩토리 내부에서 직접 생성한 뒤
// jest.requireMock() 으로 참조한다.

jest.mock('dns/promises', () => ({
  resolve4: jest.fn(),
  resolve6: jest.fn(),
}))

jest.mock('node:http', () => ({
  request: jest.fn(),
}))

jest.mock('node:https', () => ({
  request: jest.fn(),
}))

// ─── 테스트 대상 import ───────────────────────────────────────────────────────

import { crawlHomepage } from '../crawler'
import dns from 'dns/promises'

const mockDns = dns as jest.Mocked<typeof dns>

// jest.requireMock 으로 호이스팅 이후 참조
const mockHttp = jest.requireMock('node:http') as { request: jest.Mock }

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

type ReqOptions = {
  hostname: string
  port: number
  path: string
  method: string
  headers: Record<string, string>
  lookup: (
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
  ) => void
  autoSelectFamily: boolean
}

/** http.request 가 200 OK + HTML 을 반환하도록 시뮬레이션 */
function mockSuccessfulRequest(body = '<html><body>공개 콘텐츠입니다</body></html>'): {
  captureOptions: () => ReqOptions | undefined
} {
  const incoming = new EventEmitter() as IncomingMessage
  ;(incoming as unknown as { statusCode: number; headers: Record<string, string> }).statusCode = 200
  ;(incoming as unknown as { statusCode: number; headers: Record<string, string> }).headers = {
    'content-type': 'text/html',
  }

  const req = new EventEmitter()
  ;(req as unknown as { end: jest.Mock; destroy: jest.Mock }).end = jest.fn()
  ;(req as unknown as { end: jest.Mock; destroy: jest.Mock }).destroy = jest.fn()

  mockHttp.request.mockImplementationOnce(
    (opts: ReqOptions, callback: (res: IncomingMessage) => void) => {
      setTimeout(() => {
        callback(incoming)
        setTimeout(() => {
          incoming.emit('data', Buffer.from(body))
          incoming.emit('end')
        }, 0)
      }, 0)
      return req
    }
  )

  return {
    captureOptions: () => mockHttp.request.mock.calls[0]?.[0] as ReqOptions | undefined,
  }
}

// ─── 테스트 ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
})

describe('H2 — resolveAndValidateIps: 사설 IP 차단', () => {
  test('DNS 가 루프백 IP 를 반환하면 BLOCKED_HOST 에러', async () => {
    mockDns.resolve4 = jest.fn().mockResolvedValue(['127.0.0.1'])
    mockDns.resolve6 = jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'ENODATA' }))

    await expect(crawlHomepage('http://evil.host/')).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    })
  })

  test('DNS 가 AWS 메타데이터 IP 를 반환하면 BLOCKED_HOST 에러', async () => {
    mockDns.resolve4 = jest.fn().mockResolvedValue(['169.254.169.254'])
    mockDns.resolve6 = jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'ENODATA' }))

    await expect(crawlHomepage('http://metadata.internal/')).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    })
  })

  test('DNS 조회 전혀 실패하면 BLOCKED_HOST 에러', async () => {
    mockDns.resolve4 = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error(), { code: 'ENOTFOUND' }))
    mockDns.resolve6 = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error(), { code: 'ENOTFOUND' }))

    await expect(crawlHomepage('http://no-such-host.invalid/')).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    })
  })

  test('IP 리터럴 사설 주소는 DNS 조회 없이 BLOCKED_HOST', async () => {
    await expect(crawlHomepage('http://192.168.1.1/')).rejects.toMatchObject({
      code: 'BLOCKED_HOST',
    })
    expect(mockDns.resolve4).not.toHaveBeenCalled()
  })
})

describe('H2 — makePinnedLookup: 연결 시점 DNS 핀 고정', () => {
  test('lookup 옵션이 http.request 에 전달된다', async () => {
    mockDns.resolve4 = jest.fn().mockResolvedValue(['8.8.8.8'])
    mockDns.resolve6 = jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'ENODATA' }))

    const { captureOptions } = mockSuccessfulRequest()

    await crawlHomepage('http://example.com/')

    const opts = captureOptions()
    expect(typeof opts?.lookup).toBe('function')
  })

  test('pinned lookup 은 검증된 IP 만 반환한다', async () => {
    mockDns.resolve4 = jest.fn().mockResolvedValue(['8.8.8.8'])
    mockDns.resolve6 = jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'ENODATA' }))

    const { captureOptions } = mockSuccessfulRequest()

    await crawlHomepage('http://example.com/')

    const opts = captureOptions()
    let resolvedAddress = ''
    opts!.lookup('example.com', {}, (err, address) => {
      expect(err).toBeNull()
      resolvedAddress = address
    })
    expect(resolvedAddress).toBe('8.8.8.8')
  })

  test('autoSelectFamily: false 옵션이 전달된다', async () => {
    mockDns.resolve4 = jest.fn().mockResolvedValue(['8.8.8.8'])
    mockDns.resolve6 = jest.fn().mockRejectedValue(Object.assign(new Error(), { code: 'ENODATA' }))

    const { captureOptions } = mockSuccessfulRequest()

    await crawlHomepage('http://example.com/')

    expect(captureOptions()?.autoSelectFamily).toBe(false)
  })
})

describe('H2 — http(s) URL scheme 검증', () => {
  test('file:// URL 은 INVALID_URL 에러', async () => {
    await expect(crawlHomepage('file:///etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_URL',
    })
  })

  test('javascript: URL 은 INVALID_URL 에러', async () => {
    await expect(crawlHomepage('javascript:alert(1)')).rejects.toMatchObject({
      code: 'INVALID_URL',
    })
  })
})
