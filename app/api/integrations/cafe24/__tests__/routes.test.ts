/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { fakeDb } from '@/lib/cafe24/__tests__/fake-db'

jest.mock('@/lib/prisma', () => ({
  prisma: jest.requireActual('@/lib/cafe24/__tests__/fake-db').fakePrisma,
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: (_p: string, s: string) => ({ encrypted: s, iv: 'v1' }),
  decryptField: (_p: string, e: string) => e,
}))
jest.mock('@/lib/agent/audit', () => ({ maskSecrets: (s: string) => s }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/cafe24/client', () => ({
  ...jest.requireActual('@/lib/cafe24/client'),
  exchangeCode: jest.fn(),
  probeOrders: jest.fn(),
}))

import { getUser } from '@/hooks/use-user'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { exchangeCode, probeOrders } from '@/lib/cafe24/client'
import { CAFE24_NONCE_COOKIE, createCafe24State, verifyCafe24State } from '@/lib/cafe24/oauth-state'
import { buildAppUrl, getAppOrigin } from '@/lib/domain'
import { registerCafe24 } from '@/lib/cafe24/store'
import { POST as install } from '../install/route'
import { GET as callback } from '../callback/route'

const SP = 'sp1'
const U = 'user1'
const APP = { clientId: 'cid-1234567', clientSecret: 'CSECRET-xyz', mallId: 'myshop24' }
const mockedUser = getUser as jest.Mock
const mockedAdmin = requireSpaceAdmin as jest.Mock
const mockedAal2 = requireAal2 as jest.Mock
const mockedExchange = exchangeCode as jest.Mock
const mockedProbe = probeOrders as jest.Mock
const forbidden = () => ({
  error: NextResponse.json({ message: '권한이 없습니다' }, { status: 403 }),
})

function seedRow() {
  fakeDb.seed(
    SP,
    { clientId: APP.clientId, clientSecret: APP.clientSecret },
    { mallId: APP.mallId, credVersion: 1, status: 'needs_auth' }
  )
}

beforeEach(() => {
  process.env.SLACK_SIGNING_SECRET = 'test-signing-secret'
  fakeDb.reset()
  jest.clearAllMocks()
  mockedUser.mockResolvedValue({ id: U })
  mockedAdmin.mockResolvedValue({ userId: U, role: 'ADMIN' })
  mockedAal2.mockResolvedValue(null)
  mockedProbe.mockResolvedValue(undefined)
  mockedExchange.mockResolvedValue({
    accessToken: 'AT1',
    refreshToken: 'RT1',
    accessExpiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    mallId: APP.mallId,
    scopes: ['mall.read_order', 'mall.write_order'],
  })
})

function installReq(init: { origin?: string | null; spaceId?: string; mallId?: string } = {}) {
  const body = new URLSearchParams({
    spaceId: init.spaceId ?? SP,
    mallId: init.mallId ?? APP.mallId,
  })
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (init.origin !== null) headers.origin = init.origin ?? getAppOrigin()
  return new NextRequest(buildAppUrl('/api/integrations/cafe24/install'), {
    method: 'POST',
    headers,
    body,
  })
}

describe('install', () => {
  it('Origin 이 앱 도메인과 다르면 거부한다', async () => {
    seedRow()
    expect((await install(installReq({ origin: 'https://evil.example' }))).status).toBe(403)
    expect((await install(installReq({ origin: null }))).status).toBe(403)
    expect(mockedAdmin).not.toHaveBeenCalled()
  })

  it('MEMBER(권한 없음)는 403, aal1 은 차단한다', async () => {
    seedRow()
    mockedAdmin.mockResolvedValue(forbidden())
    expect((await install(installReq())).status).toBe(403)
    mockedAdmin.mockResolvedValue({ userId: U, role: 'ADMIN' })
    mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    const res = await install(installReq())
    expect(res.status).toBe(403)
    expect(res.headers.get('location')).toBeNull()
  })

  it('그 쇼핑몰 행이 없거나 mallId 형식이 틀리면 400', async () => {
    expect((await install(installReq())).status).toBe(400)
    seedRow()
    expect((await install(installReq({ mallId: 'othershop' }))).status).toBe(400)
    expect((await install(installReq({ mallId: 'evil.com/x' }))).status).toBe(400)
  })

  it('두 번째 쇼핑몰은 그 몰 호스트·행으로 state 를 만든다(레거시 행과 공존)', async () => {
    seedRow()
    fakeDb.seed(
      SP,
      { clientId: APP.clientId, clientSecret: APP.clientSecret },
      { mallId: 'second-shop', credVersion: 1, status: 'needs_auth' },
      'cafe24:second-shop'
    )
    const res = await install(installReq({ mallId: 'second-shop' }))
    const loc = new URL(((await res.json()) as { url: string }).url)
    expect(loc.host).toBe('second-shop.cafe24api.com')
    expect(verifyCafe24State(loc.searchParams.get('state')!)).toMatchObject({
      mallId: 'second-shop',
    })
  })

  it('성공하면 authorize 주소(JSON url) + nonce 쿠키 + 서명 state', async () => {
    seedRow()
    const res = await install(installReq())
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    const loc = new URL(((await res.json()) as { url: string }).url)
    expect(loc.origin + loc.pathname).toBe('https://myshop24.cafe24api.com/api/v2/oauth/authorize')
    expect(loc.searchParams.get('response_type')).toBe('code')
    expect(loc.searchParams.get('client_id')).toBe(APP.clientId)
    expect(loc.searchParams.get('scope')).toBe('mall.read_order mall.write_order')
    expect(loc.searchParams.get('redirect_uri')).toBe(
      buildAppUrl('/api/integrations/cafe24/callback')
    )
    expect(verifyCafe24State(loc.searchParams.get('state')!)).toMatchObject({
      spaceId: SP,
      userId: U,
      mallId: APP.mallId,
    })
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain(`${CAFE24_NONCE_COOKIE}=`)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toContain('Path=/api/integrations/cafe24')
  })

  it('SLACK_SIGNING_SECRET 이 없으면 503', async () => {
    seedRow()
    delete process.env.SLACK_SIGNING_SECRET
    expect((await install(installReq())).status).toBe(503)
  })
})

function cbReq(
  opts: { state?: string; nonce?: string | null; extra?: Record<string, string> } = {}
) {
  const made = createCafe24State({
    spaceId: SP,
    userId: U,
    clientId: APP.clientId,
    mallId: APP.mallId,
  })!
  const q = new URLSearchParams({ code: 'CODE1', state: opts.state ?? made.state, ...opts.extra })
  const nonce = opts.nonce === undefined ? made.nonce : opts.nonce
  const headers: Record<string, string> = {}
  if (nonce) headers.cookie = `${CAFE24_NONCE_COOKIE}=${nonce}`
  return new NextRequest(`${buildAppUrl('/api/integrations/cafe24/callback')}?${q}`, { headers })
}
const resultOf = (res: Response) => new URL(res.headers.get('location')!).searchParams.get('cafe24')

describe('callback', () => {
  beforeEach(seedRow)

  const cookieCleared = (res: Response) =>
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${CAFE24_NONCE_COOKIE}=;`))

  it('state 위조는 spaceId 없이 expired 로 돌려보내고 교환하지 않는다', async () => {
    const res = await callback(cbReq({ state: 'forged.state' }))
    expect(resultOf(res)).toBe('expired')
    expect(new URL(res.headers.get('location')!).searchParams.has('spaceId')).toBe(false)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('nonce 없음·불일치는 expired 로 거부하고 쿠키를 지운다', async () => {
    for (const nonce of [null, 'other']) {
      const res = await callback(cbReq({ nonce }))
      expect(resultOf(res)).toBe('expired')
      cookieCleared(res)
    }
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('다른 사용자·MEMBER 는 forbidden, aal1 은 mfa_required 로 돌려보내고 쿠키를 지운다', async () => {
    mockedUser.mockResolvedValue({ id: 'someone-else' })
    let res = await callback(cbReq())
    expect(resultOf(res)).toBe('forbidden')
    cookieCleared(res)
    mockedUser.mockResolvedValue({ id: U })
    mockedAdmin.mockResolvedValue(forbidden())
    res = await callback(cbReq())
    expect(resultOf(res)).toBe('forbidden')
    cookieCleared(res)
    mockedAdmin.mockResolvedValue({ userId: U, role: 'ADMIN' })
    mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    res = await callback(cbReq())
    expect(resultOf(res)).toBe('mfa_required')
    expect(new URL(res.headers.get('location')!).searchParams.get('spaceId')).toBe(SP)
    cookieCleared(res)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('code 가 없으면 error 로 돌려보내고 쿠키를 지운다', async () => {
    const req = cbReq()
    const noCode = new URL(req.url)
    noCode.searchParams.delete('code')
    const res = await callback(new NextRequest(noCode, { headers: req.headers }))
    expect(resultOf(res)).toBe('error')
    cookieCleared(res)
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('성공 뒤 쿠키가 삭제되면 같은 state+code 재사용은 거부된다', async () => {
    const req = cbReq()
    const first = await callback(req)
    expect(resultOf(first)).toBe('connected')
    cookieCleared(first)
    // 브라우저는 삭제된 쿠키를 더 보내지 않는다 — 같은 state+code 를 쿠키 없이 재전송
    const state = new URL(req.url).searchParams.get('state')!
    const replay = await callback(cbReq({ state, nonce: null }))
    expect(resultOf(replay)).toBe('expired')
    expect(mockedExchange).toHaveBeenCalledTimes(1)
  })

  it('사용자가 거부하면 denied', async () => {
    const res = await callback(cbReq({ extra: { error: 'access_denied' } }))
    expect(resultOf(res)).toBe('denied')
    expect(mockedExchange).not.toHaveBeenCalled()
  })

  it('성공: 토큰 저장 → 주문 조회 1회 → connected, nonce 쿠키 삭제', async () => {
    const res = await callback(cbReq())
    expect(resultOf(res)).toBe('connected')
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/settings/integrations')
    expect(loc.searchParams.get('open')).toBe('cafe24')
    expect(loc.searchParams.get('spaceId')).toBe(SP)
    expect(loc.searchParams.get('mall')).toBe(APP.mallId)
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${CAFE24_NONCE_COOKIE}=;`))
    expect(mockedExchange).toHaveBeenCalledWith(
      APP.mallId,
      APP.clientId,
      APP.clientSecret,
      'CODE1',
      buildAppUrl('/api/integrations/cafe24/callback')
    )
    expect(mockedProbe).toHaveBeenCalledTimes(1)
    expect(fakeDb.secret).toMatchObject({
      accessToken: 'AT1',
      refreshToken: 'RT1',
      clientSecret: APP.clientSecret,
    })
    expect(fakeDb.row.config).toMatchObject({
      status: 'connected',
      connectedBy: U,
      scopes: ['mall.read_order', 'mall.write_order'],
    })
    expect(fakeDb.row.config.connectedAt).toEqual(expect.any(String))
  })

  it('응답 mall_id 가 다르면 저장하지 않는다', async () => {
    mockedExchange.mockResolvedValueOnce({ ...(await mockedExchange()), mallId: 'othershop' })
    const res = await callback(cbReq())
    expect(resultOf(res)).toBe('mall_mismatch')
    expect(fakeDb.secret.accessToken).toBeUndefined()
  })

  it('권한(scope)이 부족하면 저장하지 않는다', async () => {
    mockedExchange.mockResolvedValueOnce({
      ...(await mockedExchange()),
      scopes: ['mall.read_order'],
    })
    const res = await callback(cbReq())
    expect(resultOf(res)).toBe('scope_missing')
    expect(fakeDb.secret.accessToken).toBeUndefined()
  })

  it('scope 표기가 달라도(READ_ORDER 등) 정규화해 통과한다', async () => {
    mockedExchange.mockResolvedValueOnce({
      ...(await mockedExchange()),
      scopes: ['READ_ORDER', 'write_order'],
    })
    expect(resultOf(await callback(cbReq()))).toBe('connected')
  })

  it('콜백 중 앱 정보가 바뀌면 토큰을 저장하지 않는다', async () => {
    mockedExchange.mockImplementationOnce(async () => {
      await registerCafe24(SP, {
        clientId: 'new-client-id',
        clientSecret: 'new-secret-123',
        mallId: APP.mallId,
      })
      return {
        accessToken: 'AT1',
        refreshToken: 'RT1',
        accessExpiresAt: new Date(Date.now() + 7_200_000).toISOString(),
        refreshExpiresAt: new Date(Date.now() + 9e8).toISOString(),
        mallId: APP.mallId,
        scopes: ['read_order', 'write_order'],
      }
    })
    const res = await callback(cbReq())
    expect(resultOf(res)).toBe('error')
    expect(fakeDb.secret.accessToken).toBeUndefined()
    expect(fakeDb.secret.clientId).toBe('new-client-id')
  })

  it('교환 실패는 error, 오류 기록에 비밀값이 없다', async () => {
    mockedExchange.mockRejectedValueOnce(
      new Error('카페24 code-exchange 실패 (HTTP 400): invalid_grant')
    )
    const res = await callback(cbReq())
    expect(resultOf(res)).toBe('error')
    expect(fakeDb.row.lastError).toBe('카페24 code-exchange 실패 (HTTP 400): invalid_grant')
    expect(fakeDb.row.lastError).not.toContain('CODE1')
  })

  it('주문 조회가 실패하면 connected 가 되지 않는다', async () => {
    mockedProbe.mockRejectedValueOnce(new Error('카페24 api 실패 (HTTP 403): forbidden'))
    const res = await callback(cbReq())
    expect(resultOf(res)).toBe('error')
    expect(fakeDb.row.config.status).toBe('needs_auth')
  })

  it('state.mallId 의 행만 읽고 쓴다(다른 쇼핑몰 행은 건드리지 않는다)', async () => {
    fakeDb.seed(
      SP,
      { clientId: APP.clientId, clientSecret: APP.clientSecret },
      { mallId: 'second-shop', credVersion: 1, status: 'needs_auth' },
      'cafe24:second-shop'
    )
    expect(resultOf(await callback(cbReq()))).toBe('connected')
    expect(mockedProbe).toHaveBeenCalledWith(SP, APP.mallId)
    expect(fakeDb.rows[0].config.status).toBe('connected') // 레거시 행(provider 유지)
    expect(fakeDb.rows[0].provider).toBe('cafe24')
    expect(fakeDb.rows[1].config.status).toBe('needs_auth')
  })
})
