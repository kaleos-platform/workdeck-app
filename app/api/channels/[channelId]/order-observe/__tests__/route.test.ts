/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveAnyDeckContext: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findFirst: jest.fn() },
    channelFulfillmentSetting: { findMany: jest.fn(), upsert: jest.fn() },
    pipelineOperation: { updateMany: jest.fn() },
    spaceCredential: { findMany: jest.fn(), findUnique: jest.fn() },
  },
}))

import { resolveAnyDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { PUT } from '../route'

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>
const SP = 'sp1'
const put = async (body: unknown) =>
  (await PUT(new NextRequest('https://app.test/x', { method: 'PUT', body: JSON.stringify(body) }), {
    params: Promise.resolve({ channelId: 'ch1' }),
  }))!
const mallRow = (mallId: string) => ({
  config: { mallId, status: 'connected' },
  lastError: null,
  healthError: null,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveAnyDeckContext as jest.Mock).mockResolvedValue({ space: { id: SP }, role: 'ADMIN' })
  db.channel.findFirst.mockResolvedValue({ id: 'ch1', fulfillmentSetting: null })
  db.spaceCredential.findMany.mockResolvedValue([mallRow('legacy-shop'), mallRow('shop-a')])
  db.spaceCredential.findUnique.mockResolvedValue({ config: { mallId: 'legacy-shop' } })
  db.channelFulfillmentSetting.findMany.mockResolvedValue([])
  db.channelFulfillmentSetting.upsert.mockImplementation(async ({ create }) => ({
    ...create,
    reconcileMode: 'diagnose',
    matchKeyRule: null,
  }))
})

describe('카페24 storeKey(쇼핑몰)', () => {
  it('켤 때 storeKey 필수(400)·형식 오류(400)·연결 안 된 몰(400)', async () => {
    expect((await put({ observeEnabled: true, adapter: 'cafe24' })).status).toBe(400)
    expect(
      (await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'Bad_Mall!' })).status
    ).toBe(400)
    expect(
      (await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'ghost-shop' })).status
    ).toBe(400)
    expect(db.channelFulfillmentSetting.upsert).not.toHaveBeenCalled()
  })

  it('레거시 행의 몰도 선택할 수 있고 storeKey 가 저장된다', async () => {
    const res = await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'legacy-shop' })
    expect(res.status).toBe(200)
    expect(db.channelFulfillmentSetting.upsert.mock.calls[0][0].create.storeKey).toBe('legacy-shop')
    expect((await res.json()).setting.storeKey).toBe('legacy-shop')
  })

  it('같은 몰을 쓰는 다른 켜진 채널이 있으면 409(null storeKey 는 레거시 몰로 해석)', async () => {
    db.channelFulfillmentSetting.findMany.mockResolvedValue([{ storeKey: 'shop-a' }])
    expect(
      (await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'shop-a' })).status
    ).toBe(409)
    db.channelFulfillmentSetting.findMany.mockResolvedValue([{ storeKey: null }])
    expect(
      (await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'legacy-shop' })).status
    ).toBe(409)
    // 다른 몰이면 허용
    expect(
      (await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'shop-a' })).status
    ).toBe(200)
  })

  it('끌 때는 storeKey 없이도 저장된다', async () => {
    expect((await put({ observeEnabled: false, adapter: 'cafe24' })).status).toBe(200)
  })
})

describe('설정 변경(reset)', () => {
  const prev = (over = {}) => ({
    channelId: 'ch1',
    observeEnabled: true,
    adapter: 'cafe24',
    storeKey: 'legacy-shop',
    reconcileMode: 'diagnose',
    matchKeyRule: null,
    ...over,
  })

  it('몰이 바뀌면 커서·lease 를 비우고 진행 중 operation 을 setting_changed 로 닫는다', async () => {
    db.channel.findFirst.mockResolvedValue({ id: 'ch1', fulfillmentSetting: prev() })
    await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'shop-a' })
    const update = db.channelFulfillmentSetting.upsert.mock.calls[0][0].update
    expect(update.observeCursor).toBeDefined()
    expect(update.observeLease).toBeDefined()
    expect(db.pipelineOperation.updateMany).toHaveBeenCalledWith({
      where: { channelId: 'ch1', status: 'STARTED' },
      data: expect.objectContaining({ status: 'FAILED', error: 'setting_changed' }),
    })
  })

  it('몰이 그대로면 lease·커서·operation 을 건드리지 않는다', async () => {
    db.channel.findFirst.mockResolvedValue({ id: 'ch1', fulfillmentSetting: prev() })
    await put({ observeEnabled: true, adapter: 'cafe24', storeKey: 'legacy-shop' })
    const update = db.channelFulfillmentSetting.upsert.mock.calls[0][0].update
    expect(update.observeCursor).toBeUndefined()
    expect(update.observeLease).toBeUndefined()
    expect(db.pipelineOperation.updateMany).not.toHaveBeenCalled()
  })
})
