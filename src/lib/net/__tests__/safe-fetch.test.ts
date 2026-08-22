/**
 * @jest-environment node
 */
import { isBlockedAddress, safeFetchHtml, SafeFetchError } from '../safe-fetch'

jest.mock('node:dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}))

import dns from 'node:dns'

const mockLookup = dns.promises.lookup as jest.Mock

describe('isBlockedAddress', () => {
  it('IPv4 10.0.0.0/8 경계값을 판정한다', () => {
    expect(isBlockedAddress('9.255.255.255', 4)).toBe(false)
    expect(isBlockedAddress('10.0.0.0', 4)).toBe(true)
    expect(isBlockedAddress('10.255.255.255', 4)).toBe(true)
    expect(isBlockedAddress('11.0.0.0', 4)).toBe(false)
  })

  it('클라우드 메타데이터·CGNAT 주소를 차단한다', () => {
    expect(isBlockedAddress('169.254.169.254', 4)).toBe(true)
    expect(isBlockedAddress('100.64.0.1', 4)).toBe(true)
  })

  it('공인 IPv4는 허용한다', () => {
    expect(isBlockedAddress('8.8.8.8', 4)).toBe(false)
    expect(isBlockedAddress('1.1.1.1', 4)).toBe(false)
  })

  it('IPv6 사설/루프백/링크로컬/멀티캐스트를 차단한다', () => {
    expect(isBlockedAddress('::1', 6)).toBe(true)
    expect(isBlockedAddress('fd00::1', 6)).toBe(true)
    expect(isBlockedAddress('fe80::1', 6)).toBe(true)
    expect(isBlockedAddress('ff02::1', 6)).toBe(true)
  })

  it('공인 IPv6는 허용한다', () => {
    expect(isBlockedAddress('2606:4700::1111', 6)).toBe(false)
  })

  it('IPv4-mapped IPv6 주소를 언맵하여 판정한다', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1', 6)).toBe(true)
    expect(isBlockedAddress('::ffff:8.8.8.8', 6)).toBe(false)
  })
})

describe('safeFetchHtml', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    mockLookup.mockReset()
    global.fetch = jest.fn()
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('file: scheme을 거부한다', async () => {
    await expect(safeFetchHtml('file:///etc/passwd')).rejects.toMatchObject({
      code: 'SCHEME_NOT_ALLOWED',
    })
  })

  it('data: scheme을 거부한다', async () => {
    await expect(safeFetchHtml('data:text/html,x')).rejects.toMatchObject({
      code: 'SCHEME_NOT_ALLOWED',
    })
  })

  it('userinfo가 포함된 URL을 거부한다', async () => {
    await expect(safeFetchHtml('http://user:pw@example.com/')).rejects.toMatchObject({
      code: 'USERINFO_NOT_ALLOWED',
    })
  })

  it('허용되지 않은 포트를 거부한다', async () => {
    await expect(safeFetchHtml('http://example.com:22/')).rejects.toMatchObject({
      code: 'PORT_NOT_ALLOWED',
    })
  })

  it('사설 주소로 해석되는 호스트를 거부한다', async () => {
    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === 'internal.test') {
        return Promise.resolve([{ address: '10.0.0.5', family: 4 }])
      }
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
    })

    await expect(safeFetchHtml('http://internal.test/')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })
  })

  it('리다이렉트가 사설 주소를 가리키면 해당 홉을 요청하지 않고 차단한다', async () => {
    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === 'example.com') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
      }
      return Promise.resolve([{ address: '10.0.0.1', family: 4 }])
    })
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/' }),
    })

    await expect(safeFetchHtml('http://example.com/')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })

    // 리다이렉트 대상은 DNS/주소 검증에서 걸려야 하므로 두 번째 fetch는 발생하지 않는다.
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('리다이렉트가 4회 이상이면 TOO_MANY_REDIRECTS', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    ;(global.fetch as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({
        status: 302,
        headers: new Headers({ location: `${url}?n=1` }),
      })
    )

    await expect(safeFetchHtml('http://example.com/')).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    })
  })

  it('허용되지 않은 content-type을 거부한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
    })

    await expect(safeFetchHtml('http://example.com/')).rejects.toMatchObject({
      code: 'CONTENT_TYPE_NOT_ALLOWED',
    })
  })

  it('본문이 2MB를 초과하면 truncated=true로 절단한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

    const CHUNK_SIZE = 1024 * 1024
    const chunk = new Uint8Array(CHUNK_SIZE).fill(97) // 'a'
    let calls = 0
    const reader = {
      read: jest.fn(() => {
        calls += 1
        if (calls <= 3) {
          return Promise.resolve({ done: false, value: chunk })
        }
        return Promise.resolve({ done: true, value: undefined })
      }),
      cancel: jest.fn(() => Promise.resolve()),
    }

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      body: { getReader: () => reader },
    })

    const result = await safeFetchHtml('http://example.com/')
    expect(result.truncated).toBe(true)
    expect(result.html.length).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(reader.cancel).toHaveBeenCalled()
  })
})
