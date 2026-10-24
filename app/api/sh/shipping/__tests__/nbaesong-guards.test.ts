jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
  errorResponse: (message: string, status: number) => ({
    status,
    json: async () => ({ error: message }),
  }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    delBatch: { findUnique: jest.fn() },
    delOrder: { findUnique: jest.fn(), findMany: jest.fn() },
    delOrderItem: { findFirst: jest.fn() },
    invProductOption: { findFirst: jest.fn() },
    channelProductAlias: { upsert: jest.fn().mockResolvedValue({ id: 'alias-1' }) },
    channelProductAliasFulfillment: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/sh/batch-delete', () => ({ deleteBatchWithMovements: jest.fn() }))
jest.mock('@/lib/sh/batch-outbound', () => ({ applyBatchOutboundForBatch: jest.fn() }))
jest.mock('@/lib/agent/integrations/space-credential', () => ({
  loadSpaceCredentialConfig: jest.fn().mockResolvedValue({ locationId: 'loc-1', stores: [] }),
}))
jest.mock('@/lib/naver-commerce/nbaesong-sync', () => ({
  recomputeNbaesongOutbound: jest.fn().mockResolvedValue({}),
}))
jest.mock('@/lib/del/channel-import-parser', () => ({ parseWithMapping: jest.fn() }))
jest.mock('@/lib/del/encryption', () => ({ encryptOrderPii: jest.fn().mockReturnValue({}) }))
jest.mock('@/lib/del/resolve-order-items', () => ({
  loadItemResolver: jest.fn().mockResolvedValue((name: string, quantity: number) => ({
    name,
    quantity,
    optionId: null,
    listingId: null,
    fulfillments: [],
  })),
}))
jest.mock('@/lib/sh/xlsx-encryption', () => ({
  isEncryptedXlsx: () => false,
  decryptXlsxBuffer: jest.fn(),
  WrongPasswordError: class extends Error {},
}))

import { prisma } from '@/lib/prisma'
import { recomputeNbaesongOutbound } from '@/lib/naver-commerce/nbaesong-sync'
import { parseWithMapping } from '@/lib/del/channel-import-parser'
import { PATCH as _batchPatch, DELETE as _batchDelete } from '../batches/[batchId]/route'
import { PATCH as _orderPatch, DELETE as _orderDelete } from '../orders/[orderId]/route'
import { POST as _clonePost } from '../orders/[orderId]/clone/route'
import {
  PATCH as _itemPatch,
  DELETE as _itemDelete,
} from '../orders/[orderId]/items/[itemId]/route'
import { POST as _itemsPost } from '../orders/[orderId]/items/route'
import { PATCH as _matchPatch } from '../orders/[orderId]/items/[itemId]/match/route'
import { POST as _importPost } from '../import/route'

// 핸들러는 Response | undefined 를 돌려주므로 테스트에서는 단언으로 좁힌다.
const run =
  <A extends unknown[]>(fn: (...a: A) => Promise<Response | undefined>) =>
  async (...a: A) =>
    (await fn(...a))!
const batchPatch = run(_batchPatch)
const batchDelete = run(_batchDelete)
const orderPatch = run(_orderPatch)
const orderDelete = run(_orderDelete)
const clonePost = run(_clonePost)
const itemPatch = run(_itemPatch)
const itemDelete = run(_itemDelete)
const matchPatch = run(_matchPatch)
const importPost = run(_importPost)
const itemsPost = run(_itemsPost)

const db = prisma as unknown as Record<string, Record<string, jest.Mock>> & {
  $transaction: jest.Mock
}

const req = (body: unknown = {}) => ({ json: async () => body }) as never
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const NB_ORDER = 'N배송 자동 수집 주문은 변경할 수 없습니다'

beforeEach(() => {
  jest.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe('N배송 묶음/주문 읽기전용', () => {
  test('batch PATCH/DELETE → 400', async () => {
    db.delBatch.findUnique.mockResolvedValue({
      spaceId: 'space-1',
      status: 'COMPLETED',
      source: 'NAVER_API',
    })
    const p = await batchPatch(req({ label: 'x' }), ctx({ batchId: 'b' }))
    const d = await batchDelete(req(), ctx({ batchId: 'b' }))
    expect(p.status).toBe(400)
    expect(d.status).toBe(400)
    expect((await d.json()).error).toBe('N배송 자동 수집 묶음은 변경할 수 없습니다')
  })

  test('order PATCH/DELETE/clone → 400', async () => {
    db.delOrder.findUnique.mockResolvedValue({
      spaceId: 'space-1',
      batch: { status: 'COMPLETED', source: 'NAVER_API' },
    })
    const c = ctx({ orderId: 'o' })
    for (const res of [
      await orderPatch(req({ memo: 'x' }), c),
      await orderDelete(req(), c),
      await clonePost(req(), c),
    ]) {
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(NB_ORDER)
    }
  })

  test('item 추가 POST → 400', async () => {
    db.delOrder.findFirst = jest.fn().mockResolvedValue({
      id: 'o',
      spaceId: 'space-1',
      batch: { source: 'NAVER_API' },
    })
    const res = await itemsPost(req({ name: 'x', quantity: 1 }), ctx({ orderId: 'o' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(NB_ORDER)
  })

  test('item PATCH/DELETE → 400', async () => {
    db.delOrderItem.findFirst.mockResolvedValue({
      id: 'i',
      order: { spaceId: 'space-1', batch: { source: 'NAVER_API' } },
      fulfillments: [],
    })
    const c = ctx({ orderId: 'o', itemId: 'i' })
    expect((await itemPatch(req({ quantity: 2 }), c)).status).toBe(400)
    expect((await itemDelete(req(), c)).status).toBe(400)
  })
})

describe('N배송 매칭', () => {
  const item = (skuMappings: unknown) => ({
    id: 'i',
    name: '상품',
    quantity: 1,
    skuMappings,
    order: {
      id: 'o',
      spaceId: 'space-1',
      channelId: 'ch-nb',
      orderDate: new Date('2026-10-24T16:00:00.000Z'), // KST 10-25 01:00
      batch: { source: 'NAVER_API' },
      channel: { externalSource: 'naver_nbaesong:shop1' },
    },
  })
  const c = ctx({ orderId: 'o', itemId: 'i' })

  beforeEach(() => {
    db.invProductOption.findFirst.mockResolvedValue({
      id: 'opt-1',
      name: 'o',
      product: { id: 'p', name: 'p' },
    })
    db.delOrderItem.update = jest.fn()
    db.delOrderItemFulfillment = { deleteMany: jest.fn() }
  })

  test('saveAlias:false 여도 alias 강제 + 단일 skuMapping 이면 bc: alias + 재계산', async () => {
    db.delOrderItem.findFirst.mockResolvedValue(
      item([{ nsBarcode: 'NS123', pickingQuantityPerOrder: 1 }])
    )
    const res = await matchPatch(req({ mode: 'option', optionId: 'opt-1', saveAlias: false }), c)
    expect(res.status).toBe(200)
    const names = db.channelProductAlias.upsert.mock.calls.map(
      (a) => a[0].where.channelId_aliasName.aliasName
    )
    expect(names).toEqual(['상품', 'bc:ns123'])
    expect(recomputeNbaesongOutbound).toHaveBeenCalledWith({
      spaceId: 'space-1',
      storeKey: 'shop1',
      channelId: 'ch-nb',
      locationId: 'loc-1',
      dayKst: '2026-10-25',
    })
  })

  test('skuMapping 2개면 bc: alias 없음', async () => {
    db.delOrderItem.findFirst.mockResolvedValue(item([{ nsBarcode: 'A' }, { nsBarcode: 'B' }]))
    await matchPatch(req({ mode: 'option', optionId: 'opt-1' }), c)
    const names = db.channelProductAlias.upsert.mock.calls.map(
      (a) => a[0].where.channelId_aliasName.aliasName
    )
    expect(names).toEqual(['상품'])
  })

  test('clear → 400', async () => {
    db.delOrderItem.findFirst.mockResolvedValue(item(null))
    const res = await matchPatch(req({ mode: 'clear' }), c)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('N배송 자동 수집 주문은 매칭 해제할 수 없습니다')
  })
})

describe('엑셀 import 중복 제외', () => {
  test('NAVER_API 로 이미 들어온 orderNumber 는 건너뛴다', async () => {
    db.delBatch.findUnique.mockResolvedValue({ spaceId: 'space-1', status: 'DRAFT' })
    db.delOrder.findMany.mockResolvedValue([{ orderNumber: 'ON-1' }])
    const mk = (n: string, row: number) => ({
      recipientName: 'a',
      phone: '1',
      address: 'x',
      orderDate: '2026-10-25',
      orderNumber: n,
      productName: 'p',
      productQuantity: 1,
      sourceRowNumber: row,
    })
    ;(parseWithMapping as jest.Mock).mockReturnValue({
      rows: [mk('ON-1', 2), mk('ON-2', 3)],
      errors: [],
    })
    const form = new Map<string, unknown>([
      ['file', { arrayBuffer: async () => new ArrayBuffer(8) }],
      ['batchId', 'b'],
      ['channelId', 'ch-rep'],
      ['columnMapping', '{}'],
    ])
    db.delOrder.create = jest.fn().mockResolvedValue({ id: 'new' })
    db.delOrderItem.create = jest.fn().mockResolvedValue({ id: 'it' })
    const res = await importPost({ formData: async () => form } as never)
    const body = await res.json()
    expect(db.delOrder.findMany.mock.calls[0][0].where).toEqual({
      spaceId: 'space-1',
      orderNumber: { in: ['ON-1', 'ON-2'] },
      batch: { source: 'NAVER_API' },
      channel: { representativeChannelId: 'ch-rep' },
    })
    expect(body.created).toBe(1)
    expect(body.errors).toEqual([{ row: 2, message: 'N배송 자동 수집 주문 — 건너뜀' }])
  })
})
