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
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/agent/integrations/meta-ads', () => ({ fetchAdAccountCurrencies: jest.fn() }))
jest.mock('@/lib/agent/integrations/naver-searchad', () => ({ verifyNaverCred: jest.fn() }))
jest.mock('@/lib/naver-commerce/nbaesong-channel', () => ({ ensureNbaesongChannel: jest.fn() }))
jest.mock('@/lib/naver-commerce/client', () => ({ nbaesongStoreLocationId: jest.fn() }))

import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { DELETE, PUT } from '../route'

const SP = 'sp1'
const mockedAdmin = requireSpaceAdmin as jest.Mock
const mockedAal2 = requireAal2 as jest.Mock

const put = (body: unknown) =>
  PUT(new NextRequest('https://app.test/x', { method: 'PUT', body: JSON.stringify(body) }), {
    params: Promise.resolve({ spaceId: SP, provider: 'cafe24' }),
  })
const body = (over: { clientId?: string; clientSecret?: string; mallId?: string } = {}) => ({
  secret: {
    clientId: over.clientId ?? 'cid-1234567',
    clientSecret: over.clientSecret ?? 'CSECRET-xyz',
  },
  config: { mallId: over.mallId ?? 'myshop24' },
})

beforeEach(() => {
  fakeDb.reset()
  jest.clearAllMocks()
  mockedAdmin.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
  mockedAal2.mockResolvedValue(null)
})

it('MEMBER 는 403, aal1 은 차단한다', async () => {
  mockedAdmin.mockResolvedValue({ error: NextResponse.json({}, { status: 403 }) })
  expect((await put(body())).status).toBe(403)
  mockedAdmin.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
  mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
  expect((await put(body())).status).toBe(403)
  expect(fakeDb.rows).toHaveLength(0)
})

it('최초 등록은 행을 만들고 credVersion 1·승인 필요 상태, 응답에 비밀값이 없다', async () => {
  const res = await put(body())
  expect(res.status).toBe(200)
  expect(JSON.stringify(await res.json())).not.toContain('CSECRET')
  expect(fakeDb.row.config).toEqual({ mallId: 'myshop24', credVersion: 1, status: 'needs_auth' })
  expect(fakeDb.secret).toEqual({ clientId: 'cid-1234567', clientSecret: 'CSECRET-xyz' })
})

it('입력 검증: mallId 형식·토큰 필드는 받지 않는다', async () => {
  expect((await put(body({ mallId: 'Bad_Mall!' }))).status).toBe(400)
  expect((await put(body({ mallId: 'evil.com/x' }))).status).toBe(400)
  await put({
    ...body(),
    secret: { ...body().secret, accessToken: 'INJECTED', refreshToken: 'INJECTED' },
  })
  expect(JSON.stringify(fakeDb.rows)).not.toContain('INJECTED')
})

describe('재등록', () => {
  const connected = () =>
    fakeDb.seed(
      SP,
      {
        clientId: 'cid-1234567',
        clientSecret: 'OLD-secret-1',
        accessToken: 'AT',
        refreshToken: 'RT',
      },
      {
        mallId: 'myshop24',
        credVersion: 5,
        status: 'connected',
        refreshLease: { owner: 'x', until: 1 },
        connectedAt: 'T',
      }
    )

  it('같은 clientId·mallId 로 시크릿만 바꾸면 토큰을 유지한다', async () => {
    connected()
    expect((await put(body({ clientSecret: 'NEW-secret-123' }))).status).toBe(200)
    expect(fakeDb.secret).toMatchObject({
      clientSecret: 'NEW-secret-123',
      accessToken: 'AT',
      refreshToken: 'RT',
    })
    expect(fakeDb.row.config).toMatchObject({ status: 'connected', credVersion: 6 })
  })

  it('clientId 가 바뀌면 기존 토큰을 폐기하고 승인 필요로 돌린다', async () => {
    connected()
    await put(body({ clientId: 'other-client-id' }))
    expect(fakeDb.secret).toEqual({ clientId: 'other-client-id', clientSecret: 'CSECRET-xyz' })
    expect(fakeDb.row.config).toEqual({ mallId: 'myshop24', credVersion: 6, status: 'needs_auth' })
  })

  it('다른 mallId 는 새 쇼핑몰로 추가되고 기존 몰(레거시 행)·토큰은 그대로다', async () => {
    connected()
    expect((await put(body({ mallId: 'another-shop' }))).status).toBe(200)
    expect(fakeDb.rows).toHaveLength(2)
    expect(fakeDb.rows[0]).toMatchObject({ provider: 'cafe24' })
    expect(fakeDb.secret.refreshToken).toBe('RT')
    expect(fakeDb.rows[1]).toMatchObject({ provider: 'cafe24:another-shop' })
  })

  it('같은 mallId 를 레거시 행이 이미 갖고 있으면 새 행을 만들지 않는다', async () => {
    connected()
    await put(body())
    expect(fakeDb.rows).toHaveLength(1)
  })

  it('읽은 뒤 다른 쓰기와 겹치면 409 이고 덮어쓰지 않는다', async () => {
    connected()
    fakeDb.beforeUpdateMany = () => {
      fakeDb.row.config = { ...fakeDb.row.config, credVersion: 6 }
      fakeDb.beforeUpdateMany = null
    }
    expect((await put(body({ clientSecret: 'NEW-secret-123' }))).status).toBe(409)
    expect(fakeDb.secret.clientSecret).toBe('OLD-secret-1')
  })

  it('동시 최초 생성 충돌(unique)도 409', async () => {
    const { fakePrisma } = jest.requireActual('@/lib/cafe24/__tests__/fake-db')
    fakePrisma.spaceCredential.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error('unique'), { code: 'P2002' })
    })
    expect((await put(body())).status).toBe(409)
  })
})

describe('쇼핑몰 추가·앱 정보 수정·삭제', () => {
  const seedMall = (mallId: string, over: Record<string, unknown> = {}) =>
    fakeDb.seed(
      SP,
      {
        clientId: 'cid-1234567',
        clientSecret: 'CSECRET-xyz',
        accessToken: 'AT',
        refreshToken: 'RT',
      },
      { mallId, credVersion: 1, status: 'connected', ...over },
      `cafe24:${mallId}`
    )
  const del = (mallId?: string) =>
    DELETE(
      new NextRequest(`https://app.test/x${mallId ? `?mallId=${mallId}` : ''}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ spaceId: SP, provider: 'cafe24' }) }
    )

  it('새 쇼핑몰은 앱 정보가 필수(400) — 다른 몰의 앱 정보를 복사하지 않는다', async () => {
    const res = await put({ config: { mallId: 'first-shop' } })
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('앱 정보')
    expect(fakeDb.rows).toHaveLength(0)
    seedMall('first-shop')
    expect((await put({ config: { mallId: 'second-shop' } })).status).toBe(400)
    expect(fakeDb.rows).toHaveLength(1)
    expect(
      (
        await put({
          config: { mallId: 'second-shop' },
          secret: { clientId: 'other-account-cid', clientSecret: 'OTHER-secret-1' },
        })
      ).status
    ).toBe(200)
    expect(JSON.parse(fakeDb.rows[1].encryptedPayload)).toEqual({
      clientId: 'other-account-cid',
      clientSecret: 'OTHER-secret-1',
    })
    expect(JSON.parse(fakeDb.rows[0].encryptedPayload).clientId).toBe('cid-1234567')
  })

  it('이미 있는 몰에 secret 없이 추가하면 그대로 200', async () => {
    seedMall('first-shop')
    expect((await put({ config: { mallId: 'first-shop' } })).status).toBe(200)
    expect(fakeDb.rows).toHaveLength(1)
    expect(fakeDb.rows[0].config.credVersion).toBe(1)
  })

  it('한도 5(레거시 행 포함)를 넘기면 400', async () => {
    fakeDb.seed(
      SP,
      { clientId: 'cid-1234567', clientSecret: 'CSECRET-xyz' },
      { mallId: 'legacy-shop', credVersion: 1, status: 'connected' }
    )
    for (const m of ['shop-a', 'shop-b', 'shop-c', 'shop-d']) seedMall(m)
    const res = await put({ config: { mallId: 'shop-f' } })
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('최대 5개')
    expect(fakeDb.rows).toHaveLength(5)
  })

  it('앱 정보 수정은 그 몰만 바꾼다 — clientId 가 바뀌면 그 몰 토큰만 폐기', async () => {
    fakeDb.seed(
      SP,
      {
        clientId: 'cid-1234567',
        clientSecret: 'CSECRET-xyz',
        accessToken: 'AT',
        refreshToken: 'RT',
      },
      { mallId: 'legacy-shop', credVersion: 3, status: 'connected' }
    )
    seedMall('shop-a')
    expect(
      (
        await put({
          config: { mallId: 'shop-a' },
          secret: { clientId: 'brand-new-client', clientSecret: 'NEW-secret-123' },
        })
      ).status
    ).toBe(200)
    const [legacy, a] = fakeDb.rows
    expect(JSON.parse(a.encryptedPayload)).toEqual({
      clientId: 'brand-new-client',
      clientSecret: 'NEW-secret-123',
    })
    expect(a.config.status).toBe('needs_auth')
    expect(JSON.parse(legacy.encryptedPayload)).toMatchObject({
      clientId: 'cid-1234567',
      refreshToken: 'RT',
    })
    expect(legacy.config).toMatchObject({ credVersion: 3, status: 'connected' })
  })

  it('secret 만 바뀌면(같은 clientId) 그 몰 토큰을 유지하고 다른 몰은 그대로', async () => {
    seedMall('shop-a')
    seedMall('shop-b')
    await put({
      config: { mallId: 'shop-a' },
      secret: { clientId: 'cid-1234567', clientSecret: 'NEW-secret-123' },
    })
    expect(JSON.parse(fakeDb.rows[0].encryptedPayload)).toMatchObject({
      clientSecret: 'NEW-secret-123',
      refreshToken: 'RT',
    })
    expect(JSON.parse(fakeDb.rows[1].encryptedPayload).clientSecret).toBe('CSECRET-xyz')
  })

  it('쇼핑몰 ID 없이 앱 정보만 보내면(전체 수정) 400 — 아무 행도 바뀌지 않는다', async () => {
    seedMall('shop-a')
    const res = await put({
      secret: { clientId: 'brand-new-client', clientSecret: 'NEW-secret-123' },
    })
    expect(res.status).toBe(400)
    expect(JSON.parse(fakeDb.rows[0].encryptedPayload).clientId).toBe('cid-1234567')
  })

  it('몰이 없는데 앱 정보만 보내면 400', async () => {
    expect(
      (await put({ secret: { clientId: 'cid-1234567', clientSecret: 'CSECRET-xyz' } })).status
    ).toBe(400)
  })

  it('config·secret 둘 다 없으면 400', async () => {
    expect((await put({})).status).toBe(400)
  })

  it('DELETE: 삭제 성공 · 없으면 404 · 형식 오류 400 · MFA/권한 차단 · 다른 provider 405', async () => {
    seedMall('shop-a')
    seedMall('shop-b')
    expect((await del()).status).toBe(400)
    expect((await del('nope-shop')).status).toBe(404)
    mockedAal2.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    expect((await del('shop-a')).status).toBe(403)
    mockedAal2.mockResolvedValue(null)
    mockedAdmin.mockResolvedValue({ error: NextResponse.json({}, { status: 403 }) })
    expect((await del('shop-a')).status).toBe(403)
    mockedAdmin.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
    expect(fakeDb.rows).toHaveLength(2)
    expect((await del('shop-a')).status).toBe(200)
    expect(fakeDb.rows.map((r) => r.provider)).toEqual(['cafe24:shop-b'])
    const other = await DELETE(
      new NextRequest('https://app.test/x?mallId=shop-b', { method: 'DELETE' }),
      {
        params: Promise.resolve({ spaceId: SP, provider: 'meta-ads' }),
      }
    )
    expect(other.status).toBe(405)
  })

  it('DELETE 가드: 관측 켜진 채널이 그 몰을 쓰면 409(storeKey null 은 레거시 몰로 해석)', async () => {
    fakeDb.seed(
      SP,
      { clientId: 'cid-1234567', clientSecret: 'CSECRET-xyz' },
      { mallId: 'legacy-shop', credVersion: 1, status: 'connected' }
    )
    seedMall('shop-a')
    fakeDb.settings.push(
      { spaceId: SP, adapter: 'cafe24', observeEnabled: true, storeKey: 'shop-a' },
      { spaceId: SP, adapter: 'cafe24', observeEnabled: true, storeKey: null }
    )
    const a = await del('shop-a')
    expect(a.status).toBe(409)
    expect((await a.json()).message).toContain('주문 관측 중인 판매채널')
    expect((await del('legacy-shop')).status).toBe(409)
    fakeDb.settings = []
    expect((await del('legacy-shop')).status).toBe(200)
    expect(fakeDb.rows.map((r) => r.provider)).toEqual(['cafe24:shop-a'])
  })
})
