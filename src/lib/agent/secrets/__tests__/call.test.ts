/** @jest-environment node */
import { buildRequest, filterResponse } from '../call'
import type { ApiKeyConfig, ReadOp } from '../config'

const KEY = 'SK_TEST_0123456789abcdef'
const HEADER_CFG: ApiKeyConfig = {
  baseUrl: 'https://api.example.com/v1',
  auth: { in: 'header', name: 'Authorization', template: 'Bearer {value}' },
  readOps: [],
}
const QUERY_CFG: ApiKeyConfig = { ...HEADER_CFG, auth: { in: 'query', name: 'api_key' } }
const OP: ReadOp = {
  id: 'list',
  method: 'GET',
  pathPattern: '/orders',
  query: {},
  responseFields: ['orders[].id', 'note'],
  responseHeaders: ['X-RateLimit-Remaining', 'Set-Cookie'],
}

describe('buildRequest', () => {
  it('header 주입은 Authorization: Bearer 키', () => {
    const r = buildRequest(KEY, HEADER_CFG, {
      method: 'GET',
      path: '/orders',
      query: { page: '1' },
    })
    expect(r.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(r.url.toString()).toBe('https://api.example.com/v1/orders?page=1')
    expect(r.body).toBeUndefined()
  })
  it('query 주입', () => {
    const r = buildRequest(KEY, QUERY_CFG, { method: 'GET', path: '/orders', query: {} })
    expect(r.url.searchParams.get('api_key')).toBe(KEY)
  })
  it('호출자가 query에 auth.name을 넣으면 거부', () => {
    expect(() =>
      buildRequest(KEY, QUERY_CFG, { method: 'GET', path: '/orders', query: { api_key: 'x' } })
    ).toThrow('허용되지 않는 query')
  })
  it('auth.name 충돌 검사는 대소문자를 구분하지 않는다', () => {
    expect(() =>
      buildRequest(KEY, QUERY_CFG, { method: 'GET', path: '/orders', query: { API_KEY: 'x' } })
    ).toThrow('허용되지 않는 query')
  })
  it('query가 undefined여도 동작하고, 위험한 path는 거부', () => {
    expect(() =>
      buildRequest(KEY, HEADER_CFG, { method: 'GET', path: '/orders', query: undefined as never })
    ).not.toThrow()
    expect(() =>
      buildRequest(KEY, HEADER_CFG, { method: 'GET', path: '/a/../b', query: {} })
    ).toThrow()
  })
  it('body는 JSON으로 직렬화', () => {
    const r = buildRequest(KEY, HEADER_CFG, {
      method: 'POST',
      path: '/orders',
      query: {},
      body: { a: 1 },
    })
    expect(r.body).toBe('{"a":1}')
    expect(r.headers['content-type']).toBe('application/json')
  })
})

describe('filterResponse', () => {
  const res = {
    status: 200,
    headers: { 'x-ratelimit-remaining': '9', 'set-cookie': 'sid=1', server: 'nginx' },
    json: { orders: [{ id: 1, secret: 'no' }], note: 'ok', other: 'no' },
  }
  it('허용 밖 필드와 set-cookie(허용 목록에 있어도)를 제거', () => {
    const r = filterResponse(OP, res, KEY)
    expect(r.body).toEqual({ orders: [{ id: 1 }], note: 'ok' })
    expect(r.headers).toEqual({ 'x-ratelimit-remaining': '9' })
  })
  it('허용 필드에 섞인 키 원문·base64·URL 인코딩은 [redacted]', () => {
    const b64 = Buffer.from(KEY).toString('base64')
    const r = filterResponse(OP, { ...res, json: { orders: [], note: `a ${KEY} b ${b64} c` } }, KEY)
    expect(r.body).toEqual({ orders: [], note: 'a [redacted] b [redacted] c' })
    const k2 = 'pa ss/word+1'
    const r2 = filterResponse(
      OP,
      { ...res, json: { orders: [], note: encodeURIComponent(k2) } },
      k2
    )
    expect(JSON.stringify(r2)).not.toContain(encodeURIComponent(k2))
  })
  it('op=null이면 status만', () => {
    expect(filterResponse(null, res, KEY)).toEqual({ status: 200 })
  })
})
