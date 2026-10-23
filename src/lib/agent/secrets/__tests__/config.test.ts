/** @jest-environment node */
import { ToolUserError } from '@/lib/agent/tools/errors'
import {
  apiKeyConfigSchema,
  envConfigInputSchema,
  matchReadOp,
  normalizePath,
  pickFields,
} from '../config'

const cfg = apiKeyConfigSchema.parse({
  baseUrl: 'https://api.example.com/v2',
  auth: { in: 'header', name: 'Authorization', template: 'Bearer {value}' },
  readOps: [
    {
      id: 'list_orders',
      method: 'POST',
      pathPattern: '/shops/{shopId}/orders/search',
      query: { limit: '^\\d{1,3}$' },
      body: { since: '^\\d{4}-\\d{2}-\\d{2}$' },
      responseFields: ['orders[].id', 'orders[].status', 'next'],
      responseHeaders: ['x-ratelimit-remaining'],
    },
  ],
})

describe('apiKeyConfigSchema', () => {
  it.each([
    'http://api.example.com',
    'https://1.2.3.4',
    'https://[::1]',
    'https://u:p@api.example.com',
    'https://api.example.com:8443',
    'https://api.example.com/?a=1',
    'https://api.example.com/#f',
  ])('baseUrl 거부: %s', (u) =>
    expect(apiKeyConfigSchema.safeParse({ ...cfg, baseUrl: u }).success).toBe(false)
  )

  it('baseUrl 443 포트는 허용', () =>
    expect(
      apiKeyConfigSchema.safeParse({ ...cfg, baseUrl: 'https://api.example.com:443' }).success
    ).toBe(true))

  it.each(['Host', 'cookie', 'X-HTTP-Method-Override', 'x-method-override'])(
    'auth.name 거부: %s',
    (n) =>
      expect(
        apiKeyConfigSchema.safeParse({
          ...cfg,
          auth: { in: 'header', name: n, template: '{value}' },
        }).success
      ).toBe(false)
  )

  it.each(['no placeholder', '{value}{value}'])('auth.template 거부: %s', (t) =>
    expect(
      apiKeyConfigSchema.safeParse({ ...cfg, auth: { in: 'header', name: 'X-Key', template: t } })
        .success
    ).toBe(false)
  )

  it('query 인증 허용', () =>
    expect(
      apiKeyConfigSchema.safeParse({ ...cfg, auth: { in: 'query', name: 'api_key' } }).success
    ).toBe(true))

  it('잘못된 정규식 거부', () => {
    const op = { ...cfg.readOps[0], query: { limit: '(' } }
    expect(apiKeyConfigSchema.safeParse({ ...cfg, readOps: [op] }).success).toBe(false)
  })

  it.each(['shops', '/a/../b', '/a//b', '/a/{}', '/a/b c', '/a/%2e'])(
    'pathPattern 거부: %s',
    (p) => {
      const op = { ...cfg.readOps[0], pathPattern: p }
      expect(apiKeyConfigSchema.safeParse({ ...cfg, readOps: [op] }).success).toBe(false)
    }
  )

  it('id 형식·중복·개수 제한', () => {
    const op = cfg.readOps[0]
    expect(
      apiKeyConfigSchema.safeParse({ ...cfg, readOps: [{ ...op, id: 'Bad-Id' }] }).success
    ).toBe(false)
    expect(apiKeyConfigSchema.safeParse({ ...cfg, readOps: [op, op] }).success).toBe(false)
    const many = Array.from({ length: 51 }, (_, i) => ({ ...op, id: `op_${i}` }))
    expect(apiKeyConfigSchema.safeParse({ ...cfg, readOps: many }).success).toBe(false)
  })
})

describe('normalizePath', () => {
  it.each([
    '/a/../b',
    '/a/%2e%2e/b',
    '/a//b',
    '/a/%2fb',
    '/a?x=1',
    '/a#f',
    'a/b',
    '/a/./b',
    '/a\\b',
    '/a\nb',
  ])('거부: %s', (p) => expect(() => normalizePath(p)).toThrow(ToolUserError))
  it('정상 경로는 그대로 반환', () =>
    expect(normalizePath('/shops/s1/orders')).toBe('/shops/s1/orders'))
})

describe('matchReadOp', () => {
  const base = {
    op: 'list_orders',
    method: 'POST',
    path: '/shops/s1/orders/search',
    query: { limit: '50' },
    body: { since: '2026-10-01' } as Record<string, unknown>,
  }

  it('POST 조회 operation 매칭', () => {
    expect(matchReadOp(cfg, base).id).toBe('list_orders')
  })

  it('선택 키 생략 허용', () => {
    expect(matchReadOp(cfg, { ...base, query: {}, body: undefined }).id).toBe('list_orders')
  })

  it.each([
    [{ method: 'GET' }],
    [{ path: '/shops/s1/orders/delete' }],
    [{ path: '/shops/s1/orders/search/' }],
    [{ path: '/shops/s1/../orders/search' }],
    [{ query: { limit: '50', extra: '1' } }],
    [{ query: { limit: '5000' } }],
    [{ query: { limit: '50\n' } }],
    [{ body: { since: '2026-10-01', status: 'x' } }],
    [{ body: { since: { $gt: 1 } } }],
    [{ body: { since: null } }],
    [{ op: 'unknown_op' }],
    [{ op: '__proto__' }],
  ])('거부 %#', (patch) => {
    expect(() => matchReadOp(cfg, { ...base, ...patch })).toThrow(
      '등록된 조회 operation이 아닙니다'
    )
  })
})

describe('pickFields', () => {
  it('허용 경로만 남긴다', () => {
    expect(
      pickFields({ orders: [{ id: 1, status: 'A', buyer: 'x' }], next: 'c', token: 'SK' }, [
        'orders[].id',
        'orders[].status',
        'next',
      ])
    ).toEqual({ orders: [{ id: 1, status: 'A' }], next: 'c' })
  })
  it('중첩 객체와 없는 필드', () => {
    expect(pickFields({ a: { b: 1, c: 2 }, z: 1 }, ['a.b', 'missing.x'])).toEqual({ a: { b: 1 } })
  })
  it('배열이 아닌 곳에 [] 경로는 무시', () => {
    expect(pickFields({ a: 'x' }, ['a[].b'])).toEqual({})
  })
  it('최상위 배열 응답은 [].필드 경로로 고른다', () => {
    const withTop = (f: string) => ({
      ...cfg,
      readOps: [{ ...cfg.readOps[0], responseFields: [f] }],
    })
    expect(apiKeyConfigSchema.safeParse(withTop('[].id')).success).toBe(true)
    expect(apiKeyConfigSchema.safeParse(withTop('[]')).success).toBe(false)
    expect(pickFields([{ id: 1, secret: 'x' }, { id: 2 }], ['[].id'])).toEqual([
      { id: 1 },
      { id: 2 },
    ])
  })
  it('원시 응답은 빈 객체', () => {
    expect(pickFields('SK_TEST_0123456789abcdef', ['a'])).toEqual({})
  })
})

it('query·body 값이 1000자를 넘으면 정규식이 허용해도 같은 메시지로 거부', () => {
  const loose = apiKeyConfigSchema.parse({
    ...cfg,
    readOps: [{ ...cfg.readOps[0], query: { q: '.*' }, body: { s: '.*' } }],
  })
  const req = { op: 'list_orders', method: 'POST', path: '/shops/s1/orders/search' }
  expect(matchReadOp(loose, { ...req, query: { q: 'a'.repeat(1000) } }).id).toBe('list_orders')
  expect(() => matchReadOp(loose, { ...req, query: { q: 'a'.repeat(1001) } })).toThrow(
    '등록된 조회 operation이 아닙니다'
  )
  expect(() => matchReadOp(loose, { ...req, query: {}, body: { s: 'a'.repeat(1001) } })).toThrow(
    '등록된 조회 operation이 아닙니다'
  )
})

describe('envConfigInputSchema', () => {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
  const ok = {
    envName: 'VERCEL_READ_TOKEN',
    scopeNote: 'workdeck-app 배포 조회',
    expiresAt: inDays(30),
    readOnlyConfirmed: true,
  }
  it('ENV 입력 정상', () => expect(envConfigInputSchema.safeParse(ok).success).toBe(true))
  it.each([
    'PATH',
    'HOME',
    'SHELL',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'NODE_OPTIONS',
    'PYTHONPATH',
    'WORKDECK_AGENT_TOKEN',
    'lower',
    '1ABC',
  ])('%s는 거부', (envName) =>
    expect(envConfigInputSchema.safeParse({ ...ok, envName }).success).toBe(false)
  )
  it('읽기 전용 확인이 없으면 거부', () => {
    expect(envConfigInputSchema.safeParse({ ...ok, readOnlyConfirmed: false }).success).toBe(false)
    const { readOnlyConfirmed: _, ...noFlag } = ok
    expect(envConfigInputSchema.safeParse(noFlag).success).toBe(false)
  })
  it.each([
    ['past', inDays(-1)],
    ['invalid', 'not-a-date'],
    ['366d', inDays(366)],
  ])('expiresAt %s 거부', (_l, expiresAt) =>
    expect(envConfigInputSchema.safeParse({ ...ok, expiresAt }).success).toBe(false)
  )
  it('scopeNote 빈 값·501자 거부', () => {
    expect(envConfigInputSchema.safeParse({ ...ok, scopeNote: '' }).success).toBe(false)
    expect(envConfigInputSchema.safeParse({ ...ok, scopeNote: 'x'.repeat(501) }).success).toBe(
      false
    )
  })
})
