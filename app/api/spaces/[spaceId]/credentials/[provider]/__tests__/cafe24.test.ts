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
import { PUT } from '../route'

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

  it('mallId 가 바뀌어도 토큰을 폐기한다', async () => {
    connected()
    await put(body({ mallId: 'another-shop' }))
    expect(fakeDb.secret.refreshToken).toBeUndefined()
    expect(fakeDb.row.config.mallId).toBe('another-shop')
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
