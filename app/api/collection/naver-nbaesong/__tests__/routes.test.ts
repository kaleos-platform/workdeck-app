/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceCredential: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))
jest.mock('@/lib/worker-auth', () => ({ authenticateWorker: jest.fn() }))
jest.mock('@/lib/naver-commerce/nbaesong-channel', () => ({
  ensureNbaesongChannel: jest.fn(async () => 'ch1'),
}))
jest.mock('@/lib/naver-commerce/nbaesong-sync', () => ({
  syncNbaesongDay: jest.fn(async () => ({ orders: 1, items: 1 })),
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  decryptField: jest.fn(() =>
    JSON.stringify({
      stores: {
        aml: { clientId: 'CID', clientSecret: 'SEC' },
        other: { clientId: 'X', clientSecret: 'OTHER-SEC' },
      },
    })
  ),
}))
jest.mock('@/lib/agent/integrations/space-credential', () => ({
  recordCredentialError: jest.fn(),
}))
jest.mock('@/lib/slack/send-notification', () => ({
  sendSpaceNotification: jest.fn(async () => true),
}))

import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/crypto/field-crypto'
import { authenticateWorker } from '@/lib/worker-auth'
import { syncNbaesongDay } from '@/lib/naver-commerce/nbaesong-sync'
import { recordCredentialError } from '@/lib/agent/integrations/space-credential'
import { sendSpaceNotification } from '@/lib/slack/send-notification'
import { GET as plan } from '../plan/route'
import { POST as ingest } from '../ingest/route'
import { POST as finish } from '../finish/route'

const db = prisma.spaceCredential as unknown as Record<
  'findMany' | 'findUnique' | 'update' | 'updateMany',
  jest.Mock
>
const auth = authenticateWorker as jest.Mock

const store = {
  key: 'aml',
  label: '아몰',
  startDate: '2026-10-01',
  representativeChannelId: null,
  backfilledThrough: null,
}
const row = {
  id: 'cred1',
  spaceId: 'sp1',
  encryptedPayload: 'ENC',
  iv: 'IV',
  config: { locationId: 'loc1', stores: [store] },
}
const order = {
  orderId: 'o1',
  productOrderId: 'po1',
  paymentDate: '2026-10-22T01:00:00.000Z',
  productName: 'x',
  quantity: 1,
  remainQuantity: 1,
  totalPaymentAmount: 1,
  remainPaymentAmount: 1,
  productOrderStatus: 'PAYED',
  claimType: null,
  deliveryAttributeType: null,
  logisticsCompanyId: null,
  skuMappings: [],
}
const post = (body: unknown) =>
  new NextRequest('http://t/x', { method: 'POST', body: JSON.stringify(body) })
const ingestBody = (over = {}) => ({
  spaceId: 'sp1',
  storeKey: 'aml',
  dayKst: '2026-10-22',
  orders: [order],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ scope: { kind: 'space', spaceId: 'sp1' } })
  db.findUnique.mockResolvedValue(row)
  db.findMany.mockResolvedValue([row])
})

describe('인증', () => {
  it.each<[string, () => Promise<Response>]>([
    ['plan', () => plan(new NextRequest('http://t/x'))],
    ['ingest', () => ingest(post(ingestBody()))],
    ['finish', () => finish(post({ spaceId: 'sp1', storeKey: 'aml', attempted: [], ok: [] }))],
  ])('%s: 워커 키 없으면 401', async (_n, run) => {
    auth.mockResolvedValue({ error: NextResponse.json({}, { status: 401 }) })
    expect((await run()).status).toBe(401)
    expect(db.findMany).not.toHaveBeenCalled()
    expect(syncNbaesongDay).not.toHaveBeenCalled()
  })
  it.each<[string, () => Promise<Response>]>([
    ['plan', () => plan(new NextRequest('http://t/x'))],
    ['ingest', () => ingest(post(ingestBody()))],
    ['finish', () => finish(post({ spaceId: 'sp1', storeKey: 'aml', attempted: [], ok: [] }))],
  ])('%s: legacy 키는 403 — 키 하나로 전 space 비밀값이 열리지 않게', async (_n, run) => {
    auth.mockResolvedValue({ scope: { kind: 'legacy' } })
    expect((await run()).status).toBe(403)
    expect(db.findMany).not.toHaveBeenCalled()
    expect(decryptField).not.toHaveBeenCalled()
    expect(syncNbaesongDay).not.toHaveBeenCalled()
  })
  it('space 토큰은 다른 space 로 ingest/finish 불가 → 403', async () => {
    auth.mockResolvedValue({ scope: { kind: 'space', spaceId: 'other' } })
    expect((await ingest(post(ingestBody()))).status).toBe(403)
    expect(
      (await finish(post({ spaceId: 'sp1', storeKey: 'aml', attempted: [], ok: [] }))).status
    ).toBe(403)
    expect(syncNbaesongDay).not.toHaveBeenCalled()
  })
})

describe('plan', () => {
  it('일정에 든 스토어 키만 복호화해 내려가고 암호문은 안 내려감', async () => {
    const res = await plan(new NextRequest('http://t/x'))
    const json = await res.json()
    expect(json.items[0]).toMatchObject({
      spaceId: 'sp1',
      credentialId: 'cred1',
      secrets: { aml: { clientId: 'CID', clientSecret: 'SEC' } },
    })
    expect(decryptField).toHaveBeenCalledWith('space-credential', 'ENC', 'IV')
    expect(json.items[0].stores[0].key).toBe('aml')
    expect(json.items[0].stores[0].days.length).toBeGreaterThan(0)
    expect(JSON.stringify(json)).not.toMatch(/OTHER-SEC|ENC/)
  })
  it('복호화 실패면 secrets=null, 일정은 유지', async () => {
    ;(decryptField as jest.Mock).mockImplementationOnce(() => {
      throw new Error('bad key')
    })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const json = await (await plan(new NextRequest('http://t/x'))).json()
    expect(json.items[0].secrets).toBeNull()
    expect(json.items[0].stores[0].key).toBe('aml')
  })
  it('clientSecret 이 빠진 스토어 비밀값은 내려가지 않는다', async () => {
    ;(decryptField as jest.Mock).mockReturnValueOnce(
      JSON.stringify({ stores: { aml: { clientId: 'CID' } } })
    )
    const json = await (await plan(new NextRequest('http://t/x'))).json()
    expect(json.items[0].secrets).toEqual({})
  })
  it('복호화 실패 로그: field-crypto 사유는 남기고 JSON 파싱 오류의 평문 조각은 남기지 않는다', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ;(decryptField as jest.Mock).mockImplementationOnce(() => {
      throw new Error('ENCRYPTION_KEY_V1 누락')
    })
    await plan(new NextRequest('http://t/x'))
    expect(spy.mock.calls[0]).toContain('ENCRYPTION_KEY_V1 누락')
    ;(decryptField as jest.Mock).mockReturnValueOnce('{"stores":{"aml":PLAIN-SECRET')
    await plan(new NextRequest('http://t/x'))
    expect(JSON.stringify(spy.mock.calls[1])).not.toContain('PLAIN-SECRET')
    spy.mockRestore()
  })
  it('startDate 가 손상된 행은 건너뛰고 나머지를 돌려준다', async () => {
    const bad = {
      ...row,
      id: 'bad',
      spaceId: 'sp2',
      config: { locationId: 'l', stores: [{ ...store, startDate: '2026-13-01' }] },
    }
    db.findMany.mockResolvedValue([bad, row])
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await plan(new NextRequest('http://t/x'))
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i: { spaceId: string }) => i.spaceId)).toEqual(['sp1'])
  })
  it('space 토큰이면 그 space 만 조회', async () => {
    auth.mockResolvedValue({ scope: { kind: 'space', spaceId: 'sp1' } })
    await plan(new NextRequest('http://t/x'))
    expect(db.findMany.mock.calls[0]![0].where).toMatchObject({
      provider: 'naver-commerce',
      spaceId: 'sp1',
    })
  })
})

describe('ingest', () => {
  it('검증 오류 → 400', async () => {
    expect((await ingest(post(ingestBody({ orders: [{ orderId: 1 }] })))).status).toBe(400)
    expect((await ingest(post(ingestBody({ dayKst: 'x' })))).status).toBe(400)
    expect(syncNbaesongDay).not.toHaveBeenCalled()
  })
  it('pickingQuantityPerOrder 음수 → 400', async () => {
    const bad = { ...order, skuMappings: [{ nsBarcode: 'b', pickingQuantityPerOrder: -1 }] }
    expect((await ingest(post(ingestBody({ orders: [bad] })))).status).toBe(400)
  })
  it('존재하지 않는 날짜 → 400', async () => {
    expect((await ingest(post(ingestBody({ dayKst: '2026-13-01' })))).status).toBe(400)
  })
  it('space 토큰으로 자기 space 는 적재 가능', async () => {
    auth.mockResolvedValue({ scope: { kind: 'space', spaceId: 'sp1' } })
    expect((await ingest(post(ingestBody()))).status).toBe(200)
  })
  it('없는 스토어 → 404', async () => {
    expect((await ingest(post(ingestBody({ storeKey: 'nope' })))).status).toBe(404)
  })
  it('적재 결과를 돌려준다', async () => {
    const res = await ingest(post(ingestBody()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ orders: 1, items: 1 })
    expect(syncNbaesongDay).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'sp1',
        storeKey: 'aml',
        channelId: 'ch1',
        locationId: 'loc1',
        dayKst: '2026-10-22',
      })
    )
  })
})

describe('finish', () => {
  const body = {
    spaceId: 'sp1',
    storeKey: 'aml',
    attempted: ['2026-10-01', '2026-10-02'],
    ok: ['2026-10-01'],
  }
  it('커서 전진 + 그 스토어 오류만 해소', async () => {
    const res = await finish(post(body))
    expect(await res.json()).toEqual({ backfilledThrough: '2026-10-01' })
    const data = db.update.mock.calls[0]![0].data
    expect(data.config.stores[0].backfilledThrough).toBe('2026-10-01')
    expect(data).not.toHaveProperty('lastError')
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: 'cred1', lastError: { startsWith: '[aml] ' } },
      data: { lastError: null },
    })
  })
  it('error 면 스토어 접두어로 기록하고 해소하지 않는다', async () => {
    await finish(post({ ...body, error: 'boom' }))
    expect(recordCredentialError).toHaveBeenCalledWith('cred1', '[aml] boom')
    expect(db.update.mock.calls[0]![0].data).not.toHaveProperty('lastError')
    expect(db.updateMany).not.toHaveBeenCalled()
  })
  it('aml 실패 후 kreamd 성공 → aml 오류는 남는다', async () => {
    db.findUnique.mockResolvedValue({
      ...row,
      config: { ...row.config, stores: [store, { ...store, key: 'kreamd' }] },
    })
    await finish(post({ ...body, error: 'boom' }))
    await finish(post({ ...body, storeKey: 'kreamd' }))
    expect(recordCredentialError).toHaveBeenCalledWith('cred1', '[aml] boom')
    expect(db.updateMany).toHaveBeenCalledTimes(1)
    expect(db.updateMany.mock.calls[0]![0].where.lastError).toEqual({ startsWith: '[kreamd] ' })
  })

  describe('실패 알림', () => {
    const notify = sendSpaceNotification as jest.Mock
    const withState = (state: object) => db.findUnique.mockResolvedValue({ ...row, ...state })

    it('첫 실패(직전 오류 없음)는 알리지 않는다', async () => {
      withState({ lastError: null, healthError: null, healthAlertedAt: null })
      await finish(post({ ...body, error: 'boom' }))
      expect(notify).not.toHaveBeenCalled()
    })
    it('연속 실패면 1회 알리고 알림 상태를 남긴다', async () => {
      withState({ lastError: '[kreamd] x', healthError: null, healthAlertedAt: null })
      await finish(post({ ...body, error: '<!channel> boom' }))
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]![0].spaceId).toBe('sp1')
      expect(notify.mock.calls[0]![0].text).toContain('&lt;!channel&gt; boom')
      const alertUpdate = db.update.mock.calls.at(-1)![0].data
      expect(alertUpdate.healthError).toBe('[aml] <!channel> boom')
      expect(alertUpdate.healthAlertedAt).toBeInstanceOf(Date)
    })
    it('이미 알렸으면 다시 알리지 않는다', async () => {
      withState({ lastError: '[aml] x', healthError: '[aml] x', healthAlertedAt: new Date() })
      await finish(post({ ...body, error: 'boom' }))
      expect(notify).not.toHaveBeenCalled()
    })
    it('발송 실패면 알림 상태를 남기지 않는다(다음 실행에 재시도)', async () => {
      withState({ lastError: '[aml] x', healthError: null, healthAlertedAt: null })
      notify.mockResolvedValueOnce(false)
      await finish(post({ ...body, error: 'boom' }))
      expect(db.update).toHaveBeenCalledTimes(1) // 커서 갱신만
    })
    it('알린 스토어가 성공하면 복구를 알리고 상태를 지운다', async () => {
      withState({ lastError: '[aml] x', healthError: '[aml] x', healthAlertedAt: new Date() })
      await finish(post(body))
      expect(notify.mock.calls[0]![0].text).toContain('복구')
      expect(db.update.mock.calls.at(-1)![0].data).toEqual({ healthError: null, healthAlertedAt: null })
    })
    it('다른 스토어 성공은 복구로 보지 않는다', async () => {
      withState({ lastError: '[kreamd] x', healthError: '[kreamd] x', healthAlertedAt: new Date() })
      await finish(post(body))
      expect(notify).not.toHaveBeenCalled()
    })
  })
})
