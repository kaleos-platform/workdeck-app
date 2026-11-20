/** @jest-environment node */
import { fakeDb } from './fake-db'

jest.mock('@/lib/prisma', () => ({ prisma: jest.requireActual('./fake-db').fakePrisma }))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: (_p: string, s: string) => ({ encrypted: s, iv: 'v1' }),
  decryptField: (_p: string, e: string) => e,
}))
jest.mock('@/lib/slack/send-notification', () => ({
  sendSpaceNotification: jest.fn(async () => true),
}))
jest.mock('@/lib/agent/audit', () => ({ maskSecrets: (s: string) => s }))

import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { Cafe24Error, cafe24Get, getAccessToken, refreshTokens } from '../client'
import { readCafe24, registerCafe24, writeCafe24If } from '../store'

jest.setTimeout(20_000)

const SP = 'sp1'
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
const tokenBody = (n: number) => ({
  access_token: `AT${n}`,
  refresh_token: `RT${n}`,
  expires_at: null,
  mall_id: 'myshop24',
  scopes: ['mall.read_order', 'mall.write_order'],
})

function seed(
  over: { access?: string; accessHours?: number; config?: Record<string, unknown> } = {}
) {
  fakeDb.seed(
    SP,
    {
      clientId: 'cid-1234567',
      clientSecret: 'CSECRET-xyz',
      accessToken: over.access ?? 'AT0',
      refreshToken: 'RT0',
    },
    {
      mallId: 'myshop24',
      credVersion: 1,
      status: 'connected',
      accessExpiresAt: hours(over.accessHours ?? 1),
      ...over.config,
    }
  )
}

const fetchMock = jest.fn()
const tokenCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/oauth/token'))
let consoleSpies: jest.SpyInstance[]

beforeEach(() => {
  fakeDb.reset()
  fetchMock.mockReset()
  jest.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
  consoleSpies = (['log', 'error', 'warn', 'info'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation()
  )
})
afterEach(() => consoleSpies.forEach((s) => s.mockRestore()))

describe('getAccessToken', () => {
  it('만료 5분보다 여유가 있으면 갱신하지 않는다', async () => {
    seed({ accessHours: 1 })
    expect((await getAccessToken(SP)).accessToken).toBe('AT0')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('만료 임박(5분 이내)만 갱신하고 새 토큰·버전을 저장한다', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockResolvedValue(json(tokenBody(1)))
    const r = await getAccessToken(SP)
    expect(r.accessToken).toBe('AT1')
    expect(tokenCalls()).toHaveLength(1)
    const [url, init] = tokenCalls()[0]
    expect(url).toBe('https://myshop24.cafe24api.com/api/v2/oauth/token')
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('cid-1234567:CSECRET-xyz').toString('base64')}`
    )
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(init.body).toBe('grant_type=refresh_token&refresh_token=RT0')
    expect(fakeDb.secret).toMatchObject({ accessToken: 'AT1', refreshToken: 'RT1' })
    expect(fakeDb.row.config.credVersion).toBeGreaterThan(1)
    expect(fakeDb.row.config.refreshLease).toBeUndefined()
  })

  it('동시 갱신 둘: HTTP 는 1회, 나머지는 저장된 값을 쓴다(이중 갱신 없음)', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 200))
      return json(tokenBody(1))
    })
    const [a, b] = await Promise.all([getAccessToken(SP), getAccessToken(SP)])
    expect([a.accessToken, b.accessToken]).toEqual(['AT1', 'AT1'])
    expect(tokenCalls()).toHaveLength(1)
  })

  it('성공 응답·DB 저장을 1.5초 이상 늦춰도 대기 쪽이 재승인으로 떨어지지 않는다', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1600))
      return json(tokenBody(1))
    })
    fakeDb.beforeUpdateMany = async (data) => {
      if (String(data.encryptedPayload).includes('AT1'))
        await new Promise((r) => setTimeout(r, 1600))
    }
    const [a, b] = await Promise.all([getAccessToken(SP), getAccessToken(SP)])
    expect([a.accessToken, b.accessToken]).toEqual(['AT1', 'AT1'])
    expect(tokenCalls()).toHaveLength(1)
    expect(fakeDb.row.config.status).toBe('connected')
  })

  it('만료된 lease 는 다른 실행이 다시 잡는다', async () => {
    seed({
      accessHours: 0.05,
      config: { refreshLease: { owner: 'dead', until: Date.now() - 1000 } },
    })
    fetchMock.mockResolvedValue(json(tokenBody(1)))
    expect((await getAccessToken(SP)).accessToken).toBe('AT1')
  })

  it('갱신 중 clientId 가 바뀌면 옛 토큰을 다시 저장하지 않는다', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockImplementation(async () => {
      await registerCafe24(SP, {
        clientId: 'new-client-id',
        clientSecret: 'new-secret-123',
        mallId: 'myshop24',
      })
      return json(tokenBody(1))
    })
    await expect(getAccessToken(SP)).rejects.toMatchObject({ code: 'not_authorized' })
    expect(fakeDb.secret).toMatchObject({ clientId: 'new-client-id' })
    expect(fakeDb.secret.refreshToken).toBeUndefined()
    expect(fakeDb.secret.accessToken).toBeUndefined()
  })

  it('토큰과 무관한 변경으로 0행이면 새 토큰을 최신 버전에 다시 병합한다', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockImplementation(async () => {
      const cur = (await readCafe24(SP))!
      await writeCafe24If(cur, cur.secret, { ...cur.config, scopes: ['x'] })
      return json(tokenBody(1))
    })
    expect((await getAccessToken(SP)).accessToken).toBe('AT1')
    expect(fakeDb.secret.refreshToken).toBe('RT1')
    expect(fakeDb.row.config.scopes).toEqual(['x'])
  })

  it('lease 밖에서 회전돼 invalid_grant 를 받으면 저장된 새 토큰을 쓴다(재승인 아님)', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockImplementation(async () => {
      const cur = (await readCafe24(SP))!
      await writeCafe24If(
        cur,
        { ...cur.secret, accessToken: 'ATX', refreshToken: 'RTX' },
        {
          ...cur.config,
          accessExpiresAt: hours(1),
        }
      )
      return json({ error: 'invalid_grant' }, 400)
    })
    expect((await getAccessToken(SP)).accessToken).toBe('ATX')
    expect(fakeDb.row.config.status).toBe('connected')
  })

  it('실제 invalid_grant 면 reauth_required 로 표시하고 알린다', async () => {
    seed({ accessHours: 0.05 })
    fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400))
    await expect(getAccessToken(SP)).rejects.toMatchObject({ code: 'reauth_required' })
    expect(fakeDb.row.config.status).toBe('reauth_required')
    expect(sendSpaceNotification).toHaveBeenCalledTimes(1)
    await expect(getAccessToken(SP)).rejects.toMatchObject({ code: 'reauth_required' })
    expect(tokenCalls()).toHaveLength(1)
  })
})

describe('cafe24Get', () => {
  const ok = () => json({ orders: [] }, 200, { 'X-Api-Call-Limit': '1/40' })

  it('조회 헤더·버전 헤더를 보낸다', async () => {
    seed()
    fetchMock.mockResolvedValue(ok())
    await cafe24Get(SP, '/admin/orders', { limit: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://myshop24.cafe24api.com/api/v2/admin/orders?limit=1')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer AT0',
      'Content-Type': 'application/json',
      'X-Cafe24-Api-Version': '2026-09-01',
    })
  })

  it('401 이면 갱신 후 1회만 재시도한다', async () => {
    seed()
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token')
        ? json(tokenBody(1))
        : fetchMock.mock.calls.filter((c) => !String(c[0]).includes('oauth')).length === 1
          ? json({}, 401)
          : ok()
    )
    await cafe24Get(SP, '/admin/orders')
    expect(fetchMock).toHaveBeenCalledTimes(3) // api(401) → token → api
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer AT1')
  })

  it('401 이 두 번 오면 더 시도하지 않고 오류를 던진다', async () => {
    seed()
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/oauth/token')
        ? json(tokenBody(1))
        : json({ error: { message: 'LEAK-BODY' } }, 401)
    )
    await expect(cafe24Get(SP, '/admin/orders')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('비밀값 미노출', () => {
  it('실패 응답 본문·토큰·Basic·시크릿이 오류 메시지·lastError·console 에 없다', async () => {
    seed({ accessHours: 0.05 })
    const basic = Buffer.from('cid-1234567:CSECRET-xyz').toString('base64')
    fetchMock.mockResolvedValue(
      json({ error: 'invalid_request', error_description: 'LEAK-BODY AT0 RT0 CSECRET-xyz' }, 400)
    )
    const err = await getAccessToken(SP).catch((e) => e)
    expect(err).toBeInstanceOf(Cafe24Error)
    const seen = [
      err.message,
      String(fakeDb.row.lastError),
      ...consoleSpies.flatMap((s) => s.mock.calls.flat().map(String)),
    ].join('\n')
    for (const leak of ['LEAK-BODY', 'AT0', 'RT0', 'CSECRET-xyz', basic, 'Basic ', 'Bearer ']) {
      expect(seen).not.toContain(leak)
    }
    expect(err.message).toContain('invalid_request')
  })

  it('응답 본문이 비정상이거나 네트워크 오류여도 원문을 싣지 않는다', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED Authorization: Basic ZZZ'))
    const e1 = await refreshTokens('myshop24', 'cid-1234567', 'CSECRET-xyz', 'RT0').catch((e) => e)
    expect(e1.message).not.toContain('ZZZ')
    fetchMock.mockResolvedValue(json({ access_token: 'only-access' }))
    const e2 = await refreshTokens('myshop24', 'cid-1234567', 'CSECRET-xyz', 'RT0').catch((e) => e)
    expect(e2.code).toBe('invalid_response')
    expect(e2.message).not.toContain('only-access')
  })

  it('알 수 없는 error 코드는 unknown 으로만 남긴다', async () => {
    fetchMock.mockResolvedValue(json({ error: 'LEAK-CODE' }, 400))
    const e = await refreshTokens('myshop24', 'cid-1234567', 'CSECRET-xyz', 'RT0').catch((x) => x)
    expect(e.code).toBe('unknown')
    expect(e.message).not.toContain('LEAK-CODE')
  })
})

it('유효하지 않은 mallId 로는 호출하지 않는다(호스트 주입 차단)', async () => {
  await expect(refreshTokens('evil.com/x', 'c', 's', 'r')).rejects.toMatchObject({
    code: 'invalid_mall_id',
  })
  expect(fetchMock).not.toHaveBeenCalled()
})
