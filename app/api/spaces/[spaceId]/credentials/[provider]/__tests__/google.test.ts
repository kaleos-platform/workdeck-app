/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { fakeDb } from '@/lib/integrations/__tests__/google-fake-db'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    ...jest.requireActual('@/lib/integrations/__tests__/google-fake-db').fakePrisma,
    agentPendingAction: { count: jest.fn(async () => 0) },
  },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: (_p: string, s: string) => ({ encrypted: s, iv: 'v1' }),
  decryptField: (_p: string, e: string) => e,
}))
jest.mock('@/lib/agent/audit', () => ({ maskSecrets: (s: string) => s }))
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/agent/integrations/meta-ads', () => ({ fetchAdAccountCurrencies: jest.fn() }))
jest.mock('@/lib/agent/integrations/naver-searchad', () => ({ verifyNaverCred: jest.fn() }))
jest.mock('@/lib/naver-commerce/nbaesong-channel', () => ({ ensureNbaesongChannel: jest.fn() }))
jest.mock('@/lib/naver-commerce/client', () => ({ nbaesongStoreLocationId: jest.fn() }))

import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { requiredGoogleScopes } from '@/lib/agent/integrations/google-marketing'
import { GET, PUT } from '../route'

const SP = 'sp1'
const GA4 = requiredGoogleScopes({ brands: {} })
const GTM_BRAND = { ga4_property_id: '1', gtm_account_id: '2', gtm_container_id: '3' }
const mockedAdmin = requireSpaceAdmin as jest.Mock
const mockedAal2 = requireAal2 as jest.Mock
const ctx = { params: Promise.resolve({ spaceId: SP, provider: 'google-marketing' }) }

const put = (body: unknown) =>
  PUT(new NextRequest('https://app.test/x', { method: 'PUT', body: JSON.stringify(body) }), ctx)
const get = () => GET(new NextRequest('https://app.test/x'), ctx)
const body = (
  over: {
    clientId?: string
    clientSecret?: string
    refreshToken?: string
    brands?: Record<string, unknown>
  } = {}
) => ({
  secret: {
    clientId: over.clientId ?? 'cid-1234567',
    clientSecret: over.clientSecret ?? 'CSECRET-xyz',
    ...(over.refreshToken ? { refreshToken: over.refreshToken } : {}),
  },
  config: { defaultBrand: 'a', brands: over.brands ?? { a: { ga4_property_id: '1' } } },
})

function seed(
  config: Record<string, unknown> = {},
  secret: Record<string, unknown> = {},
  withVersion = true
) {
  fakeDb.seed(
    SP,
    {
      clientId: 'cid-1234567',
      clientSecret: 'OLD-secret-1',
      refreshToken: 'RT-old-123',
      ...secret,
    },
    {
      defaultBrand: 'a',
      brands: { a: { ga4_property_id: '1' } },
      ...(withVersion ? { credVersion: 5 } : {}),
      status: 'connected',
      connectedAt: '2026-11-20T00:00:00.000Z',
      scopes: GA4,
      ...config,
    }
  )
}

beforeEach(() => {
  fakeDb.reset()
  jest.clearAllMocks()
  mockedAdmin.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
  mockedAal2.mockResolvedValue(null)
})

describe('PUT', () => {
  it('MEMBER 는 403, aal1 은 차단한다', async () => {
    mockedAdmin.mockResolvedValue({ error: NextResponse.json({}, { status: 403 }) })
    expect((await put(body())).status).toBe(403)
    mockedAdmin.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
    mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    expect((await put(body())).status).toBe(403)
    expect(fakeDb.rows).toHaveLength(0)
  })

  it('최초 등록(토큰 없음): credVersion 1·needs_auth, 응답에 비밀값 없음', async () => {
    const res = await put(body())
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).not.toMatch(/CSECRET/)
    expect(fakeDb.row.config).toEqual({
      defaultBrand: 'a',
      brands: { a: { ga4_property_id: '1' } },
      credVersion: 1,
      status: 'needs_auth',
    })
    expect(fakeDb.secret).toEqual({ clientId: 'cid-1234567', clientSecret: 'CSECRET-xyz' })
  })

  it('서버 관리 필드(status·connectedAt·scopes·credVersion)는 입력으로 받지 않는다', async () => {
    await put({
      ...body(),
      config: {
        ...body().config,
        status: 'connected',
        connectedAt: 'FORGED',
        scopes: ['x'],
        credVersion: 99,
      },
    })
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_auth', credVersion: 1 })
    expect(JSON.stringify(fakeDb.row.config)).not.toMatch(/FORGED/)
    expect(fakeDb.row.config.scopes).toBeUndefined()
  })

  it('refreshToken 생략 + 같은 clientId → 기존 토큰·상태·scopes 유지', async () => {
    seed()
    expect((await put(body())).status).toBe(200)
    expect(fakeDb.secret).toMatchObject({ clientSecret: 'CSECRET-xyz', refreshToken: 'RT-old-123' })
    expect(fakeDb.row.config).toMatchObject({
      status: 'connected',
      scopes: GA4,
      connectedAt: '2026-11-20T00:00:00.000Z',
      credVersion: 6,
    })
  })

  it('같은 clientId 로 clientSecret 만 바꿔도 토큰을 유지한다', async () => {
    seed()
    await put(body({ clientSecret: 'NEW-secret-123' }))
    expect(fakeDb.secret).toMatchObject({
      clientSecret: 'NEW-secret-123',
      refreshToken: 'RT-old-123',
    })
  })

  it('clientId 가 바뀌면 토큰·scopes 를 버리고 needs_auth', async () => {
    seed()
    await put(body({ clientId: 'other-client-id' }))
    expect(fakeDb.secret).toEqual({ clientId: 'other-client-id', clientSecret: 'CSECRET-xyz' })
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_auth', credVersion: 6 })
    expect(fakeDb.row.config.scopes).toBeUndefined()
    expect(fakeDb.row.config.connectedAt).toBeUndefined()
  })

  it('refreshToken 값을 지정하면 그 값을 쓴다(수동 입력 호환) — 확인 전이라 needs_check', async () => {
    seed()
    await put(body({ refreshToken: 'MANUAL-RT-1234' }))
    expect(fakeDb.secret.refreshToken).toBe('MANUAL-RT-1234')
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_check' })
    expect(fakeDb.row.config.scopes).toBeUndefined()
  })

  it('GA4 만 승인(scopes 저장)한 뒤 GTM 브랜드를 추가하면 needs_auth(토큰은 남김)', async () => {
    seed()
    await put(body({ brands: { a: GTM_BRAND } }))
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_auth', scopes: GA4 })
    expect(fakeDb.secret.refreshToken).toBe('RT-old-123')
  })

  it('scopes 없는 기존 수동 토큰 + GTM 추가 → 강등하지 않는다(status 도 만들지 않는다)', async () => {
    seed({ status: undefined, scopes: undefined, connectedAt: undefined })
    await put(body({ brands: { a: GTM_BRAND } }))
    expect(fakeDb.row.config.status).toBeUndefined()
    expect(fakeDb.secret.refreshToken).toBe('RT-old-123')
  })

  it('브랜드 GA4 속성이 바뀌면 needs_check', async () => {
    seed()
    await put(body({ brands: { a: { ga4_property_id: '77' } } }))
    expect(fakeDb.row.config).toMatchObject({ status: 'needs_check', scopes: GA4 })
    expect(fakeDb.secret.refreshToken).toBe('RT-old-123')
  })

  it('승인 부족(needs_auth)이 해소된 저장(GTM 제거)은 needs_check', async () => {
    seed({
      status: 'needs_auth',
      brands: { a: GTM_BRAND },
    })
    await put(body({ brands: { a: { ga4_property_id: '1' } } }))
    expect(fakeDb.row.config.status).toBe('needs_check')
  })

  it('기존 행(credVersion 키 없음)의 첫 PUT 이 성공하고 버전 1', async () => {
    seed({ status: undefined, scopes: undefined, connectedAt: undefined }, {}, false)
    expect(fakeDb.row.config.credVersion).toBeUndefined()
    expect((await put(body({ clientSecret: 'NEW-secret-123' }))).status).toBe(200)
    expect(fakeDb.secret).toMatchObject({
      clientSecret: 'NEW-secret-123',
      refreshToken: 'RT-old-123',
    })
    expect(fakeDb.row.config.credVersion).toBe(1)
  })

  it('읽은 뒤 콜백이 먼저 쓰면 409 이고 새 토큰·scopes 를 덮지 않는다', async () => {
    seed({ status: 'needs_auth', scopes: undefined, connectedAt: undefined })
    fakeDb.beforeUpdateMany = () => {
      // 콜백이 같은 버전을 읽고 먼저 토큰을 저장한 상황
      fakeDb.row.encryptedPayload = JSON.stringify({
        ...fakeDb.secret,
        refreshToken: 'RT-new-from-callback',
      })
      fakeDb.row.config = {
        ...fakeDb.row.config,
        scopes: GA4,
        status: 'needs_check',
        credVersion: 6,
      }
      fakeDb.beforeUpdateMany = null
    }
    expect((await put(body({ clientSecret: 'NEW-secret-123' }))).status).toBe(409)
    expect(fakeDb.secret.refreshToken).toBe('RT-new-from-callback')
    expect(fakeDb.secret.clientSecret).toBe('OLD-secret-1')
    expect(fakeDb.row.config.credVersion).toBe(6)
  })

  it('동시 최초 생성 충돌(unique)도 409', async () => {
    const { fakePrisma } = jest.requireActual('@/lib/integrations/__tests__/google-fake-db')
    fakePrisma.spaceCredential.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error('unique'), { code: 'P2002' })
    })
    expect((await put(body())).status).toBe(409)
  })

  it('GTM 한쪽만 입력하면 400 이고 아무것도 쓰지 않는다', async () => {
    seed()
    const res = await put(body({ brands: { a: { ga4_property_id: '1', gtm_account_id: '2' } } }))
    expect(res.status).toBe(400)
    expect(fakeDb.row.config.credVersion).toBe(5)
  })
})

describe('GET', () => {
  it('status·connectedAt·scopes·hasRefreshToken 를 주고 비밀값·암호문·오류 원문은 주지 않는다', async () => {
    seed()
    fakeDb.row.lastError = 'LASTERR-secret'
    const res = await get()
    const json = await res.json()
    expect(json.config).toMatchObject({
      status: 'connected',
      connectedAt: '2026-11-20T00:00:00.000Z',
      scopes: GA4,
      defaultBrand: 'a',
    })
    expect(json.hasRefreshToken).toBe(true)
    const text = JSON.stringify(json)
    expect(text).not.toMatch(
      /RT-old-123|OLD-secret-1|cid-1234567|LASTERR|encryptedPayload|credVersion/
    )
    expect(json.hasError).toBe(true)
  })

  it('토큰이 없으면 hasRefreshToken false(승인 필요)', async () => {
    seed({ status: 'needs_auth' }, { refreshToken: undefined })
    const json = await (await get()).json()
    expect(json.hasRefreshToken).toBe(false)
    expect(json.config.status).toBe('needs_auth')
  })

  it('기존 행(수동 토큰 형식, status 없음) → hasRefreshToken true, status 없음', async () => {
    seed({ status: undefined, scopes: undefined, connectedAt: undefined }, {}, false)
    const json = await (await get()).json()
    expect(json.hasRefreshToken).toBe(true)
    expect(json.config.status).toBeUndefined()
    expect(json.config.scopes).toBeUndefined()
  })

  it('미등록이면 registered false', async () => {
    expect((await (await get()).json()).registered).toBe(false)
  })
})
