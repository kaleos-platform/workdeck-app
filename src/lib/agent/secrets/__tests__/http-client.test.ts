/**
 * @jest-environment node
 */
import type http from 'node:http'
import type https from 'node:https'
import type { LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

import { secureLookup } from '@/lib/net/safe-fetch'

import { secretRequest, SecretHttpError } from '../http-client'

jest.mock('node:dns', () => ({ promises: { lookup: jest.fn() } }))
jest.mock('node:https', () => ({ request: jest.fn() }))

import dns from 'node:dns'
import httpsModule from 'node:https'

const mockLookup = dns.promises.lookup as jest.Mock
const mockHttpsRequest = httpsModule.request as unknown as jest.Mock

const PUBLIC = [{ address: '93.184.216.34', family: 4 }]
const METADATA = [{ address: '169.254.169.254', family: 4 }]
const url = new URL('https://api.example.com/v1/items')
const req = {
  url,
  method: 'GET' as const,
  headers: { authorization: 'Bearer SK_TEST_0123456789abcdef' },
}

function makeRes(statusCode: number, headers: http.IncomingHttpHeaders, chunks: Buffer[] = []) {
  const readable = Readable.from(chunks)
  Object.assign(readable, { statusCode, headers })
  return readable as unknown as http.IncomingMessage
}

/** lookup 훅을 실제로 호출해 Node connector 동작을 흉내낸다. */
function wire(res?: http.IncomingMessage) {
  mockHttpsRequest.mockImplementationOnce(
    (options: https.RequestOptions, cb: (res: http.IncomingMessage) => void) => {
      const r = {
        handlers: {} as Record<string, (e: Error) => void>,
        on(ev: string, fn: (e: Error) => void) {
          r.handlers[ev] = fn
          return r
        },
        end: jest.fn(),
        destroy: jest.fn(),
      }
      queueMicrotask(() => {
        ;(options.lookup as LookupFunction)(options.hostname as string, { all: true }, (err) => {
          if (err) r.handlers.error?.(err)
          else if (res) cb(res)
        })
      })
      return r
    }
  )
}

async function codeOf(p: Promise<unknown>) {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(SecretHttpError)
    return e as SecretHttpError
  }
  throw new Error('did not throw')
}

beforeEach(() => {
  mockLookup.mockReset()
  mockHttpsRequest.mockReset()
})

describe('secretRequest', () => {
  it('사설 주소로 풀리면 PRIVATE_ADDRESS이고 요청하지 않는다', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
    const e = await codeOf(secretRequest(req))
    expect(e.code).toBe('PRIVATE_ADDRESS')
    expect(e.message).toBe('PRIVATE_ADDRESS')
    expect(mockHttpsRequest).not.toHaveBeenCalled()
  })

  it('사전 검사 뒤 연결 시점에 사설 주소로 바뀌면(rebinding) PRIVATE_ADDRESS', async () => {
    mockLookup.mockResolvedValueOnce(PUBLIC).mockResolvedValueOnce(METADATA)
    wire(makeRes(200, {}))
    const e = await codeOf(secretRequest(req))
    expect(e.code).toBe('PRIVATE_ADDRESS')
    expect(e.message).not.toContain('169.254')
  })

  it('3xx는 따라가지 않고 REDIRECT, 오류에 Location·키가 없다', async () => {
    mockLookup.mockResolvedValue(PUBLIC)
    wire(makeRes(302, { location: 'https://evil.example/?k=SK_TEST_0123456789abcdef' }))
    const e = await codeOf(secretRequest(req))
    expect(e.code).toBe('REDIRECT')
    expect(e.message).not.toMatch(/evil|SK_TEST/)
    expect(mockHttpsRequest).toHaveBeenCalledTimes(1)
  })

  it('1MB 초과 본문은 TOO_LARGE', async () => {
    mockLookup.mockResolvedValue(PUBLIC)
    wire(makeRes(200, { 'content-type': 'application/json' }, [Buffer.alloc(2 * 1024 * 1024, 'a')]))
    expect((await codeOf(secretRequest(req))).code).toBe('TOO_LARGE')
  })

  it('text/html이면 json: null', async () => {
    mockLookup.mockResolvedValue(PUBLIC)
    wire(makeRes(200, { 'content-type': 'text/html' }, [Buffer.from('{"a":1}')]))
    expect(await secretRequest(req)).toMatchObject({ status: 200, json: null })
  })

  it('json 응답은 파싱하고 헤더를 문자열로 돌려준다', async () => {
    mockLookup.mockResolvedValue(PUBLIC)
    wire(
      makeRes(200, { 'content-type': 'application/vnd.api+json; charset=utf-8' }, [
        Buffer.from('{"a":1}'),
      ])
    )
    expect(await secretRequest(req)).toMatchObject({ status: 200, json: { a: 1 } })
  })

  it('깨진 JSON 본문은 NETWORK이고 본문이 오류에 실리지 않는다', async () => {
    mockLookup.mockResolvedValue(PUBLIC)
    wire(makeRes(200, { 'content-type': 'application/json' }, [Buffer.from('{SK_TEST_oops')]))
    const e = await codeOf(secretRequest(req))
    expect(e.code).toBe('NETWORK')
    expect(e.message).not.toContain('SK_TEST')
  })

  it('options.lookup은 secureLookup과 같은 참조, accept 고정, https만 허용', async () => {
    mockLookup.mockResolvedValue(PUBLIC)
    wire(makeRes(200, {}))
    await secretRequest({ ...req, headers: { accept: 'text/plain', 'x-a': '1' } })
    const opts = mockHttpsRequest.mock.calls[0][0] as https.RequestOptions
    expect(opts.lookup).toBe(secureLookup)
    expect(opts.agent).toBe(false)
    expect(opts.headers).toMatchObject({ accept: 'application/json', 'x-a': '1' })
    const e = await codeOf(secretRequest({ ...req, url: new URL('http://api.example.com/') }))
    expect(e.code).toBe('NETWORK')
  })

  it('https.request가 동기 throw(ERR_INVALID_CHAR 등)면 NETWORK이고 남은 타이머가 터지지 않는다', async () => {
    jest.useFakeTimers()
    try {
      mockLookup.mockResolvedValue(PUBLIC)
      mockHttpsRequest.mockImplementationOnce(() => {
        throw Object.assign(new TypeError('Invalid character in header content'), {
          code: 'ERR_INVALID_CHAR',
        })
      })
      const e = await codeOf(secretRequest({ ...req, headers: { 'x-key': 'SK_TEST\r\nX: 1' } }))
      expect(e.code).toBe('NETWORK')
      expect(e.message).not.toContain('SK_TEST')
      expect(jest.getTimerCount()).toBe(0)
      await expect(jest.advanceTimersByTimeAsync(15000)).resolves.not.toThrow()
    } finally {
      jest.useRealTimers()
    }
  })

  it('응답이 없으면 15초 뒤 TIMEOUT이고 req.destroy를 호출한다', async () => {
    jest.useFakeTimers()
    try {
      mockLookup.mockResolvedValue(PUBLIC)
      const r = { on: jest.fn().mockReturnThis(), end: jest.fn(), destroy: jest.fn() }
      mockHttpsRequest.mockReturnValueOnce(r)
      const p = codeOf(secretRequest(req))
      await jest.advanceTimersByTimeAsync(15000)
      expect((await p).code).toBe('TIMEOUT')
      expect(r.destroy).toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
