/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { count: jest.fn() },
    channel: { count: jest.fn() },
    spaceCredential: { findUnique: jest.fn() },
    delBatch: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/naver-commerce/nbaesong-channel', () => ({
  ensureNbaesongChannel: jest.fn(async () => 'ch1'),
}))
jest.mock('@/lib/agent/identity/space-admin', () => ({
  requireSpaceAdmin: jest.fn(async () => ({ userId: 'u1' })),
}))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/crypto/field-crypto', () => ({
  decryptField: jest.fn(() =>
    JSON.stringify({
      stores: { aml: { clientId: 'old-cid-0123456', clientSecret: 'o'.repeat(24) } },
    })
  ),
}))
jest.mock('@/lib/agent/integrations/space-credential', () => ({
  saveSpaceCredential: jest.fn(async () => ({ id: 'cred1' })),
  loadSpaceCredential: jest.fn(),
  recordCredentialError: jest.fn(),
}))

import { requireAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { saveSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { prisma } from '@/lib/prisma'
import { ensureNbaesongChannel } from '@/lib/naver-commerce/nbaesong-channel'
import { PUT } from '../route'

const META_BODY = {
  secret: { accessToken: 'EAAB-test-token', appSecret: 'app-secret-test' },
  // 클라이언트가 보낸 통화는 무시
  config: {
    defaultBrand: 'brand-a',
    adAccounts: { 'brand-a': '111' },
    accountCurrencies: { act_111: 'KRW' },
  },
}
const call = (provider: string, body: unknown) =>
  PUT(
    new NextRequest(`http://t/api/spaces/sp1/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ spaceId: 'sp1', provider }) }
  )
let fetchMock: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
  fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'act_111', currency: 'USD' }),
  }))
  global.fetch = fetchMock as unknown as typeof fetch
})

it('ADMIN 미만 → 그대로 거부, MFA·저장 검사 전', async () => {
  ;(requireSpaceAdmin as jest.Mock).mockResolvedValueOnce({
    error: NextResponse.json({}, { status: 403 }),
  })
  expect((await call('meta-ads', META_BODY)).status).toBe(403)
  expect(requireAal2).not.toHaveBeenCalled()
  expect(saveSpaceCredential).not.toHaveBeenCalled()
})

it('MFA 미충족 → 403 MFA_REQUIRED, 저장·Graph 호출 없음', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  const res = await call('meta-ads', META_BODY)
  expect(res.status).toBe(403)
  await expect(res.json()).resolves.toMatchObject({ code: 'MFA_REQUIRED' })
  expect(saveSpaceCredential).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('모르는 provider → 404', async () => {
  expect((await call('constructor', META_BODY)).status).toBe(404)
  expect(saveSpaceCredential).not.toHaveBeenCalled()
})

it('메타: Graph가 확인한 통화를 저장한다(클라이언트 값 무시), 응답에 비밀값 없음', async () => {
  const res = await call('meta-ads', META_BODY)
  expect(res.status).toBe(200)
  const json = await res.json()
  expect(json).toMatchObject({ accountCurrencies: { act_111: 'USD' } })
  expect(JSON.stringify(json)).not.toMatch(/EAAB|app-secret/)
  const savedConfig = (saveSpaceCredential as jest.Mock).mock.calls[0][3]
  expect(savedConfig.accountCurrencies).toEqual({ act_111: 'USD' })
})

it('메타: 계정 확인 실패 → 400, 저장하지 않는다', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Invalid OAuth access token' } }),
  })
  const res = await call('meta-ads', META_BODY)
  expect(res.status).toBe(400)
  expect(saveSpaceCredential).not.toHaveBeenCalled()
})

describe('naver-commerce', () => {
  const db = prisma as unknown as {
    invStorageLocation: { count: jest.Mock }
    channel: { count: jest.Mock }
    spaceCredential: { findUnique: jest.Mock }
    delBatch: { findFirst: jest.Mock }
  }
  const store = (over = {}) => ({
    key: 'aml',
    label: '아몰',
    startDate: '2026-10-01',
    representativeChannelId: null,
    ...over,
  })
  const body = (over: Record<string, unknown> = {}) => ({
    secret: { stores: { aml: { clientId: 'cid-0123456789', clientSecret: 'x'.repeat(24) } } },
    config: { locationId: 'loc1', stores: [store()] },
    ...over,
  })
  beforeEach(() => {
    db.invStorageLocation.count.mockImplementation(async ({ where }) => where.id.in.length)
    db.channel.count.mockResolvedValue(1)
    db.spaceCredential.findUnique.mockResolvedValue(null)
    db.delBatch.findFirst.mockResolvedValue(null)
  })

  it('저장 + 스토어별 채널 보장, backfilledThrough 는 null 로 시작', async () => {
    expect((await call('naver-commerce', body())).status).toBe(200)
    const [, , , config] = (saveSpaceCredential as jest.Mock).mock.calls[0]
    expect(config).toEqual({
      locationId: 'loc1',
      stores: [{ ...store(), backfilledThrough: null }],
    })
    expect(ensureNbaesongChannel).toHaveBeenCalledWith({
      spaceId: 'sp1',
      storeKey: 'aml',
      label: '아몰',
      representativeChannelId: null,
    })
  })
  it('응답에 clientId/clientSecret 없음', async () => {
    const res = await call('naver-commerce', body())
    expect(JSON.stringify(await res.json())).not.toMatch(/clientSecret|clientId|cid-0123456789/)
  })
  it('존재하지 않는 startDate → 400', async () => {
    const res = await call(
      'naver-commerce',
      body({ config: { locationId: 'loc1', stores: [store({ startDate: '2026-13-01' })] } })
    )
    expect(res.status).toBe(400)
    expect(saveSpaceCredential).not.toHaveBeenCalled()
  })
  it('기존 backfilledThrough 보존', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      config: { locationId: 'loc1', stores: [{ ...store(), backfilledThrough: '2026-10-10' }] },
    })
    await call('naver-commerce', body())
    const config = (saveSpaceCredential as jest.Mock).mock.calls[0][3]
    expect(config.stores[0].backfilledThrough).toBe('2026-10-10')
  })
  it('config/secret 스토어 키 불일치 → 400', async () => {
    const res = await call(
      'naver-commerce',
      body({ config: { locationId: 'loc1', stores: [store({ key: 'other' })] } })
    )
    expect(res.status).toBe(400)
    expect(saveSpaceCredential).not.toHaveBeenCalled()
  })
  it('다른 공간 위치 → 400', async () => {
    db.invStorageLocation.count.mockResolvedValue(0)
    const res = await call('naver-commerce', body())
    expect(res.status).toBe(400)
    expect(saveSpaceCredential).not.toHaveBeenCalled()
  })
  it('대표 채널이 공간 소속이 아니면 → 400', async () => {
    db.channel.count.mockResolvedValue(0)
    const res = await call(
      'naver-commerce',
      body({ config: { locationId: 'loc1', stores: [store({ representativeChannelId: 'zz' })] } })
    )
    expect(res.status).toBe(400)
    expect(saveSpaceCredential).not.toHaveBeenCalled()
  })

  const two = () =>
    body({
      secret: {
        stores: {
          aml: { clientId: 'cid-0123456789', clientSecret: 'x'.repeat(24) },
          kreamd: { clientId: 'cid-9876543210', clientSecret: 'y'.repeat(24) },
        },
      },
      config: { locationId: 'loc1', stores: [store(), store({ key: 'kreamd', label: '아몰' })] },
    })
  const errorOf = async (res: Response) => (await res.json()).message
  it('스토어 이름 중복 → 400', async () => {
    const res = await call('naver-commerce', two())
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('스토어 이름이 중복됩니다')
    expect(saveSpaceCredential).not.toHaveBeenCalled()
  })
  it('수집 이력(커서)이 있는 스토어를 빼면 → 400', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      config: {
        locationId: 'loc1',
        stores: [
          { ...store(), backfilledThrough: null },
          { ...store({ key: 'old', label: '옛' }), backfilledThrough: '2026-10-10' },
        ],
      },
    })
    const res = await call('naver-commerce', body())
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('수집 이력이 있는 스토어는 삭제할 수 없습니다')
    expect(saveSpaceCredential).not.toHaveBeenCalled()
  })
  it('커서가 null 이어도 N배송 묶음이 있으면 수집 이력으로 본다', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      config: {
        locationId: 'loc1',
        stores: [{ ...store({ key: 'old', label: '옛' }), backfilledThrough: null }],
      },
    })
    db.delBatch.findFirst.mockResolvedValue({ id: 'b1' })
    const res = await call('naver-commerce', body())
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('수집 이력이 있는 스토어는 삭제할 수 없습니다')
    expect(db.delBatch.findFirst.mock.calls[0][0].where).toEqual({
      spaceId: 'sp1',
      source: 'NAVER_API',
      label: { startsWith: 'N배송 old ' },
    })
  })
  it('수집 이력 없는 스토어는 뺄 수 있다', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      config: {
        locationId: 'loc1',
        stores: [{ ...store({ key: 'old', label: '옛' }), backfilledThrough: null }],
      },
    })
    expect((await call('naver-commerce', body())).status).toBe(200)
  })
  it('수집 이력이 있어도 위치 변경 허용 — 그 스토어 커서만 처음으로', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      encryptedPayload: 'ENC',
      iv: 'v1',
      config: {
        locationId: 'loc1',
        stores: [
          { ...store(), backfilledThrough: '2026-10-10' },
          { ...store({ key: 'kreamd', label: '크림' }), backfilledThrough: '2026-10-11' },
        ],
      },
    })
    const res = await call('naver-commerce', {
      secret: { stores: { kreamd: { clientId: 'cid-kreamd-0001', clientSecret: 'k'.repeat(24) } } },
      config: {
        locationId: 'loc1',
        stores: [store({ locationId: 'loc2' }), store({ key: 'kreamd', label: '크림' })],
      },
    })
    expect(res.status).toBe(200)
    const [, , secret, config] = (saveSpaceCredential as jest.Mock).mock.calls[0]
    expect(
      config.stores.map((s: { locationId?: string; backfilledThrough: string | null }) => [
        s.locationId,
        s.backfilledThrough,
      ])
    ).toEqual([
      ['loc2', null],
      [undefined, '2026-10-11'],
    ])
    expect(secret.stores.aml.clientId).toBe('old-cid-0123456')
  })
  it('키를 비워 두면 기존 키 유지, 새 스토어는 키 필수', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      config: { locationId: 'loc1', stores: [{ ...store(), backfilledThrough: null }] },
      encryptedPayload: 'ENC',
      iv: 'v1',
    })
    expect((await call('naver-commerce', body({ secret: { stores: {} } }))).status).toBe(200)
    expect((saveSpaceCredential as jest.Mock).mock.calls[0][2]).toEqual({
      stores: { aml: { clientId: 'old-cid-0123456', clientSecret: 'o'.repeat(24) } },
    })
    const res = await call(
      'naver-commerce',
      body({
        secret: { stores: {} },
        config: { locationId: 'loc1', stores: [store(), store({ key: 'new1', label: '새' })] },
      })
    )
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('새 스토어는 애플리케이션 ID와 시크릿을 입력해 주세요')
  })
  it('스토어별 위치가 다른 공간 소속이면 → 400', async () => {
    db.invStorageLocation.count.mockResolvedValue(1)
    const res = await call(
      'naver-commerce',
      body({ config: { locationId: 'loc1', stores: [store({ locationId: 'zz' })] } })
    )
    expect(res.status).toBe(400)
  })
  it('수집 이력이 없으면 위치 변경 허용', async () => {
    db.spaceCredential.findUnique.mockResolvedValue({
      config: { locationId: 'loc0', stores: [{ ...store(), backfilledThrough: null }] },
    })
    expect((await call('naver-commerce', body())).status).toBe(200)
  })
})
