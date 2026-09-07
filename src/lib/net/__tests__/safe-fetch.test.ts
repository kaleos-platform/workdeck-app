/**
 * @jest-environment node
 */
import type http from 'node:http'
import type https from 'node:https'
import type { LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

import { isBlockedAddress, safeFetchBinary, safeFetchHtml } from '../safe-fetch'

jest.mock('node:dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}))
jest.mock('node:http', () => ({ request: jest.fn() }))
jest.mock('node:https', () => ({ request: jest.fn() }))

import dns from 'node:dns'
import httpModule from 'node:http'
import httpsModule from 'node:https'

const mockLookup = dns.promises.lookup as jest.Mock
const mockHttpRequest = httpModule.request as unknown as jest.Mock
const mockHttpsRequest = httpsModule.request as unknown as jest.Mock

/** node:stream Readable로 만든 가짜 IncomingMessage. statusCode/headers만 흉내낸다. */
function makeRes(
  statusCode: number,
  headers: http.IncomingHttpHeaders,
  chunks: Buffer[] = []
): http.IncomingMessage {
  let index = 0
  const readable = new Readable({
    read() {
      if (index < chunks.length) {
        this.push(chunks[index])
        index += 1
      } else {
        this.push(null)
      }
    },
  })
  Object.assign(readable, { statusCode, headers, resume: () => readable })
  return readable as unknown as http.IncomingMessage
}

/** node:http(s).request()가 반환하는 ClientRequest를 흉내낸 가짜 EventEmitter 기반 객체. */
function makeFakeReq(): http.ClientRequest {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const req = {
    on(event: string, cb: (...args: unknown[]) => void) {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return req
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args)
    },
    end: jest.fn(),
    destroy: jest.fn((err?: Error) => {
      if (err) queueMicrotask(() => req.emit('error', err))
    }),
  }
  return req as unknown as http.ClientRequest
}

/**
 * 프로덕션 코드가 `options.lookup`으로 넘기는 secureLookup을 실제로 호출해,
 * Node의 실제 connector 동작(소켓 연결 직전 lookup 실행 → 결과에 따라 진행/거부)을 흉내낸다.
 * lookup이 에러를 콜백하면 req를 destroy하고(=Node가 하는 그대로), 통과하면 res를 전달한다.
 * res를 생략하면(사전에 lookup 자체가 막혀야 하는 시나리오) 성공 분기에 도달해도 아무 응답도
 * 만들지 않는다 — mockLookup을 사설 주소로 세팅해 애초에 이 분기를 안 타는지 검증하는 용도.
 */
function wireRequest(mockFn: jest.Mock, res?: http.IncomingMessage) {
  mockFn.mockImplementationOnce(
    (options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
      const req = makeFakeReq()
      queueMicrotask(() => {
        const lookup = options.lookup as LookupFunction
        lookup(options.hostname as string, { all: true }, (err) => {
          if (err) {
            req.destroy(err as NodeJS.ErrnoException)
            return
          }
          if (res) callback?.(res)
        })
      })
      return req
    }
  )
}

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
  beforeEach(() => {
    mockLookup.mockReset()
    mockHttpRequest.mockReset()
    mockHttpsRequest.mockReset()
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

  it('사설 주소로 해석되는 호스트를 사전 DNS 검사에서 거부한다', async () => {
    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === 'internal.test') {
        return Promise.resolve([{ address: '10.0.0.5', family: 4 }])
      }
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
    })

    await expect(safeFetchHtml('http://internal.test/')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })
    // 사전 검사에서 이미 걸리므로 실제 요청(request())까지는 가지 않는다.
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('리다이렉트가 사설 주소를 가리키면 해당 홉을 요청하지 않고 차단한다', async () => {
    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === 'example.com') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
      }
      return Promise.resolve([{ address: '10.0.0.1', family: 4 }])
    })
    wireRequest(mockHttpRequest, makeRes(302, { location: 'http://169.254.169.254/' }))

    await expect(safeFetchHtml('http://example.com/')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })

    // 리다이렉트 대상은 DNS/주소 검증에서 걸려야 하므로 두 번째 request()는 발생하지 않는다.
    expect(mockHttpRequest).toHaveBeenCalledTimes(1)
  })

  it('리다이렉트가 4회 이상이면 TOO_MANY_REDIRECTS', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    let n = 0
    mockHttpRequest.mockImplementation(
      (options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
        const req = makeFakeReq()
        queueMicrotask(() => {
          const lookup = options.lookup as LookupFunction
          lookup(options.hostname as string, { all: true }, (err) => {
            if (err) {
              req.destroy(err as NodeJS.ErrnoException)
              return
            }
            n += 1
            callback?.(makeRes(302, { location: `http://example.com/?n=${n}` }))
          })
        })
        return req
      }
    )

    await expect(safeFetchHtml('http://example.com/')).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    })
  })

  it('허용되지 않은 content-type을 거부한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    wireRequest(mockHttpRequest, makeRes(200, { 'content-type': 'application/pdf' }))

    await expect(safeFetchHtml('http://example.com/')).rejects.toMatchObject({
      code: 'CONTENT_TYPE_NOT_ALLOWED',
    })
  })

  it('본문이 2MB를 초과하면 truncated=true로 절단한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const CHUNK_SIZE = 1024 * 1024
    const chunk = Buffer.alloc(CHUNK_SIZE, 97) // 'a'
    wireRequest(
      mockHttpRequest,
      makeRes(200, { 'content-type': 'text/html; charset=utf-8' }, [chunk, chunk, chunk])
    )

    const result = await safeFetchHtml('http://example.com/')
    expect(result.truncated).toBe(true)
    expect(result.html.length).toBeLessThanOrEqual(2 * 1024 * 1024)
  })

  it('정상 공인 호스트는 200 응답을 그대로 반환한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    wireRequest(
      mockHttpsRequest,
      makeRes(200, { 'content-type': 'text/html; charset=utf-8' }, [Buffer.from('<html>hi</html>')])
    )

    const result = await safeFetchHtml('https://example.com/')
    expect(result.html).toBe('<html>hi</html>')
    expect(result.truncated).toBe(false)
    expect(result.finalUrl).toBe('https://example.com/')
  })

  it('lookup 훅이 connector(request 옵션)에 전달되고, 차단 주소면 EPRIVATEADDR로 콜백을 거부한다', async () => {
    mockLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // 사전 검사 통과
    mockHttpsRequest.mockImplementationOnce(() => makeFakeReq()) // 응답은 주지 않음 — 훅만 관찰

    void safeFetchHtml('https://example.com/').catch(() => {
      // 이 테스트는 request()에 전달된 lookup 훅 자체를 검증하는 것이 목적이라
      // 최종 성패는 신경 쓰지 않는다(아래에서 강제로 종료시킨다).
    })
    // validateHop(사전 DNS 검사)이 먼저 await되므로 request() 호출까지 여러 microtask가 걸린다.
    await new Promise((resolve) => setImmediate(resolve))

    expect(mockHttpsRequest).toHaveBeenCalledTimes(1)
    const options = mockHttpsRequest.mock.calls[0][0] as https.RequestOptions
    const lookup = options.lookup as LookupFunction | undefined
    expect(lookup).toBeDefined()

    // connector 단계에서 실제로 isBlockedAddress 판정을 거치는지 직접 확인한다.
    mockLookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }])
    const cb = jest.fn()
    lookup!('example.com', { all: true }, cb)
    await new Promise((resolve) => setImmediate(resolve))

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ code: 'EPRIVATEADDR' }), '')

    // 대기 중인 fake req를 정리해 열린 프로미스가 남지 않게 한다.
    const req = mockHttpsRequest.mock.results[0].value as http.ClientRequest
    req.destroy(new Error('test cleanup'))
  })

  it('DNS 리바인딩: 사전검사는 공인 IP를 보지만 connector 단계에서 사설 IP가 오면 PRIVATE_ADDRESS로 차단한다', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]) // validateHostAddresses(사전검사)
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]) // secureLookup(connector, 리바인딩)

    // res를 생략 — lookup이 정상적으로 차단하면 응답 콜백까지 도달하지 않아야 한다.
    wireRequest(mockHttpsRequest, undefined)

    await expect(safeFetchHtml('https://example.com/')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })
    expect(mockLookup).toHaveBeenCalledTimes(2)
  })

  it('본문을 read하는 도중 TIMEOUT_MS가 지나면 TIMEOUT으로 표면화된다(느리게 흘리는 방식으로 시간을 버는 것도 차단)', async () => {
    jest.useFakeTimers()
    try {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])

      // read()가 아무것도 push하지 않는 Readable — 본문이 끝나지 않고 계속 대기하는 상황을 흉내낸다.
      const stallingRes = new Readable({ read() {} })
      Object.assign(stallingRes, {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        resume: () => stallingRes,
      })
      wireRequest(mockHttpsRequest, stallingRes as unknown as http.IncomingMessage)

      const promise = safeFetchHtml('https://example.com/')
      // rejects 핸들러를 타이머를 진행시키기 전에 미리 붙여서, promise가 아직 아무도
      // 구독하지 않은 채로 reject되어 unhandled rejection이 되는 것을 막는다.
      const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' })
      // lookup 통과 → 응답 헤더 콜백까지의 microtask들을 흘려보낸다.
      await jest.advanceTimersByTimeAsync(0)
      // 본문을 읽는 도중 TIMEOUT_MS(safe-fetch.ts의 8초 상수)가 지나도록 시뮬레이션한다.
      await jest.advanceTimersByTimeAsync(8000)

      await assertion
    } finally {
      jest.useRealTimers()
    }
  })

  it('servername은 항상 원본 호스트명으로 유지된다(호스트명을 IP로 치환하지 않음)', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    wireRequest(
      mockHttpsRequest,
      makeRes(200, { 'content-type': 'text/html' }, [Buffer.from('ok')])
    )

    await safeFetchHtml('https://example.com/path')

    const options = mockHttpsRequest.mock.calls[0][0] as https.RequestOptions
    expect(options.hostname).toBe('example.com')
    expect(options.servername).toBe('example.com')
  })
})

describe('safeFetchBinary', () => {
  beforeEach(() => {
    mockLookup.mockReset()
    mockHttpRequest.mockReset()
    mockHttpsRequest.mockReset()
  })

  it('사설 주소로 해석되는 호스트를 safeFetchHtml과 동일하게 사전 DNS 검사에서 거부한다', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])

    await expect(safeFetchBinary('http://169.254.169.254/x.jpg')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })
    expect(mockHttpRequest).not.toHaveBeenCalled()
  })

  it('file: scheme을 safeFetchHtml과 동일하게 거부한다', async () => {
    await expect(safeFetchBinary('file:///etc/passwd')).rejects.toMatchObject({
      code: 'SCHEME_NOT_ALLOWED',
    })
  })

  it('리다이렉트가 사설 주소를 가리키면 해당 홉을 요청하지 않고 차단한다(TOCTOU/우회 방지 공유 검증)', async () => {
    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === 'example.com') {
        return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
      }
      return Promise.resolve([{ address: '10.0.0.1', family: 4 }])
    })
    wireRequest(mockHttpRequest, makeRes(302, { location: 'http://169.254.169.254/x.jpg' }))

    await expect(safeFetchBinary('http://example.com/x.jpg')).rejects.toMatchObject({
      code: 'PRIVATE_ADDRESS',
    })
    expect(mockHttpRequest).toHaveBeenCalledTimes(1)
  })

  it('허용되지 않은 MIME(HTML 페이지)을 CONTENT_TYPE_NOT_ALLOWED로 거부한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    wireRequest(
      mockHttpRequest,
      makeRes(200, { 'content-type': 'text/html; charset=utf-8' }, [Buffer.from('<html></html>')])
    )

    await expect(safeFetchBinary('http://example.com/x.jpg')).rejects.toMatchObject({
      code: 'CONTENT_TYPE_NOT_ALLOWED',
    })
  })

  it('기본 상한을 초과하면 자르지 않고 TOO_LARGE로 거부한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const chunk = Buffer.alloc(1024 * 1024, 1)
    wireRequest(
      mockHttpRequest,
      makeRes(200, { 'content-type': 'image/jpeg' }, Array(6).fill(chunk)) // 6MB > 기본 5MB 상한
    )

    await expect(safeFetchBinary('http://example.com/x.jpg')).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
  })

  it('maxBytes 옵션을 넘기면 그 상한을 초과할 때 TOO_LARGE로 거부한다', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    wireRequest(
      mockHttpRequest,
      makeRes(200, { 'content-type': 'image/jpeg' }, [Buffer.alloc(2048, 1)])
    )

    await expect(
      safeFetchBinary('http://example.com/x.jpg', { maxBytes: 1024 })
    ).rejects.toMatchObject({
      code: 'TOO_LARGE',
    })
  })

  it('정상 이미지는 200 응답을 그대로 반환한다(mimeType/finalUrl/bytes)', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]) // JPEG 매직바이트 흉내
    wireRequest(mockHttpRequest, makeRes(200, { 'content-type': 'image/jpeg' }, [bytes]))

    const result = await safeFetchBinary('http://example.com/x.jpg')
    expect(result.mimeType).toBe('image/jpeg')
    expect(result.finalUrl).toBe('http://example.com/x.jpg')
    expect(Buffer.compare(result.bytes, bytes)).toBe(0)
  })
})
