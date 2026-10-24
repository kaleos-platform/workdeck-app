/**
 * N배송 일 단위 동기화 e2e (dev DB). throwaway Space, afterAll 정리. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })
// dev env 에 암호화 키가 없을 수 있다 — PII 는 더미값이라 테스트용 키로 충분
process.env.ENCRYPTION_KEY_V1 ||= '11'.repeat(32)

import { prisma } from '@/lib/prisma'
import { ensureNbaesongChannel } from '../nbaesong-channel'
import { syncNbaesongDay } from '../nbaesong-sync'
import type { NaverProductOrder } from '../client'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const TAG = Date.now()
const STORE = `e2e${TAG}`
const DAY = '2026-10-20'
const NEXT_DAY = '2026-10-21'
const BC_A = `88000${TAG}1`
const BC_B = `88000${TAG}2`

let spaceId = ''
let productId = ''
let optA = ''
let optB = ''
let locationId = ''
let repChannelId = ''
let nbChannelId = ''

function po(over: Partial<NaverProductOrder> & { orderId: string }): NaverProductOrder {
  return {
    productOrderId: `${over.orderId}-p`,
    paymentDate: `${DAY}T10:00:00+09:00`,
    productName: `상품 ${TAG}`,
    quantity: 1,
    remainQuantity: 1,
    totalPaymentAmount: 10000,
    remainPaymentAmount: 10000,
    productOrderStatus: 'PAYED',
    claimType: null,
    deliveryAttributeType: 'ARRIVAL_GUARANTEE',
    logisticsCompanyId: 'LOGI',
    skuMappings: [],
    ...over,
  }
}

const o1 = () =>
  po({ orderId: `o1-${TAG}`, skuMappings: [{ nsBarcode: BC_A, pickingQuantityPerOrder: 3 }] })
const o2 = () =>
  po({
    orderId: `o2-${TAG}`,
    remainQuantity: 2,
    skuMappings: [{ nsBarcode: BC_B, pickingQuantityPerOrder: 1 }],
  })
const normal = () =>
  po({ orderId: `n-${TAG}`, deliveryAttributeType: 'NORMAL', logisticsCompanyId: null })

const run = (orders: NaverProductOrder[], repId: string | null = repChannelId) =>
  syncNbaesongDay({
    spaceId,
    storeKey: STORE,
    channelId: nbChannelId,
    locationId,
    representativeChannelId: repId,
    dayKst: DAY,
    orders,
  })

async function stock(optionId: string) {
  const r = await prisma.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  return r?.quantity ?? 0
}
const outbound = (optionId: string) =>
  prisma.invMovement.findMany({ where: { spaceId, optionId, type: 'OUTBOUND' } })
const orderCount = () => prisma.delOrder.count({ where: { spaceId, channelId: nbChannelId } })

async function reset() {
  await prisma.invMovement.deleteMany({ where: { spaceId } })
  await prisma.delBatch.deleteMany({ where: { spaceId } })
  await prisma.channelProductAlias.deleteMany({
    where: { spaceId, aliasName: { notIn: [`bc:${BC_A}`, `bc:${BC_B}`] } },
  })
  await prisma.invProduct.updateMany({ where: { id: productId }, data: { status: 'ACTIVE' } })
  await prisma.invStockLevel.updateMany({ where: { spaceId }, data: { quantity: 100 } })
}

d('N배송 일 단위 동기화 (dev DB)', () => {
  beforeAll(async () => {
    const space = await prisma.space.create({
      data: { name: `E2E NB ${TAG}`, type: 'PERSONAL' },
    })
    spaceId = space.id
    const loc = await prisma.invStorageLocation.create({
      data: { spaceId, name: `E2E 3PL ${TAG}`, type: 'THIRD_PARTY', isActive: true },
    })
    locationId = loc.id
    const group = await prisma.invProductGroup.create({ data: { spaceId, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId, name: `E2E 상품 ${TAG}`, groupId: group.id, status: 'ACTIVE' },
    })
    productId = product.id
    optA = (await prisma.invProductOption.create({ data: { productId, name: 'A' } })).id
    optB = (await prisma.invProductOption.create({ data: { productId, name: 'B' } })).id
    await prisma.invStockLevel.createMany({
      data: [optA, optB].map((optionId) => ({ spaceId, optionId, locationId, quantity: 100 })),
    })
    const typeDef = await prisma.channelTypeDef.create({
      data: { spaceId, name: '판매채널', isSalesChannel: true },
    })
    repChannelId = (
      await prisma.channel.create({
        data: { spaceId, name: `E2E 스토어 ${TAG}`, channelTypeDefId: typeDef.id },
      })
    ).id
    nbChannelId = await ensureNbaesongChannel({
      spaceId,
      storeKey: STORE,
      label: `E2E 스토어 ${TAG}`,
      representativeChannelId: repChannelId,
    })
    await prisma.channelProductAlias.createMany({
      data: [
        { spaceId, channelId: nbChannelId, aliasName: `bc:${BC_A}`, optionId: optA },
        { spaceId, channelId: nbChannelId, aliasName: `bc:${BC_B}`, optionId: optB },
      ],
    })
  })

  afterAll(async () => {
    if (!spaceId) return
    await prisma.invMovement.deleteMany({ where: { spaceId } })
    await prisma.invStockLevel.deleteMany({ where: { spaceId } })
    await prisma.delBatch.deleteMany({ where: { spaceId } })
    await prisma.channelProductAlias.deleteMany({ where: { spaceId } })
    await prisma.invProductOption.deleteMany({ where: { product: { spaceId } } })
    await prisma.invProduct.deleteMany({ where: { spaceId } })
    await prisma.invProductGroup.deleteMany({ where: { spaceId } })
    await prisma.invStorageLocation.deleteMany({ where: { spaceId } })
    await prisma.space.deleteMany({ where: { id: spaceId } })
  })

  beforeEach(reset)

  it('first sync creates batch, orders, OUTBOUND', async () => {
    const r = await run([o1(), o2(), normal()])
    expect(r.orders).toBe(2)
    expect(await orderCount()).toBe(2)
    expect((await outbound(optA)).map((m) => m.quantity)).toEqual([3])
    expect((await outbound(optB)).map((m) => m.quantity)).toEqual([2])
    expect(await stock(optA)).toBe(97)
    expect(await stock(optB)).toBe(98)
    expect(await prisma.invMovement.count({ where: { spaceId, delBatchId: { not: null } } })).toBe(
      0
    )
  })

  it('resync is idempotent', async () => {
    await run([o1(), o2()])
    const r = await run([o1(), o2()])
    expect(r.outbound.skipped).toBe(2)
    expect(await stock(optA)).toBe(97)
    expect(await orderCount()).toBe(2)
  })

  it('canceled after sync restores stock', async () => {
    await run([o1(), o2()])
    await run([{ ...o1(), productOrderStatus: 'CANCELED' }, o2()])
    expect(await orderCount()).toBe(1)
    expect(await outbound(optA)).toHaveLength(0)
    expect(await stock(optA)).toBe(100)
  })

  it('partial cancel keeps order with remaining amount', async () => {
    const id = `pc-${TAG}`
    await run([
      po({
        orderId: id,
        productOrderId: `${id}-1`,
        skuMappings: [{ nsBarcode: BC_A, pickingQuantityPerOrder: 1 }],
      }),
      po({
        orderId: id,
        productOrderId: `${id}-2`,
        productOrderStatus: 'CANCELED',
        remainPaymentAmount: 5000,
        skuMappings: [{ nsBarcode: BC_A, pickingQuantityPerOrder: 1 }],
      }),
    ])
    const orders = await prisma.delOrder.findMany({ where: { spaceId, channelId: nbChannelId } })
    expect(orders).toHaveLength(1)
    expect(Number(orders[0].paymentAmount)).toBe(10000)
  })

  it('inactive option does not abort day sync', async () => {
    await prisma.invProduct.update({ where: { id: productId }, data: { status: 'INACTIVE' } })
    const r = await run([o1(), o2()])
    expect(r.outbound.skipped).toBeGreaterThanOrEqual(1)
    expect(await orderCount()).toBe(2)
  })

  it('name alias fallback via representative channel', async () => {
    const name = `별칭상품 ${TAG}`
    await prisma.channelProductAlias.create({
      data: { spaceId, channelId: repChannelId, aliasName: name.toLowerCase(), optionId: optA },
    })
    const r = await run([po({ orderId: `na-${TAG}`, productName: name, remainQuantity: 2 })])
    expect(r.unmatched).toBe(0)
    expect((await outbound(optA)).map((m) => m.quantity)).toEqual([2])
  })

  it('skips order already imported via excel', async () => {
    const batch = await prisma.delBatch.create({
      data: { spaceId, source: 'MANUAL', status: 'COMPLETED' },
    })
    await prisma.delOrder.create({
      data: {
        spaceId,
        batchId: batch.id,
        channelId: repChannelId,
        orderNumber: o1().orderId,
        orderDate: new Date(),
        recipientNameEnc: 'x',
        recipientNameIv: 'x',
        phoneEnc: 'x',
        phoneIv: 'x',
        addressEnc: 'x',
        addressIv: 'x',
      },
    })
    const r = await run([o1(), o2()])
    expect(r.skippedExisting).toBe(1)
    expect(await orderCount()).toBe(1)
    expect(await outbound(optA)).toHaveLength(0)
  })

  it('match survives resync', async () => {
    const X = `88999${TAG}`
    const order = po({
      orderId: `mx-${TAG}`,
      skuMappings: [{ nsBarcode: X, pickingQuantityPerOrder: 1 }],
    })
    expect((await run([order])).unmatched).toBe(1)
    await prisma.channelProductAlias.create({
      data: { spaceId, channelId: nbChannelId, aliasName: `bc:${X}`, optionId: optA },
    })
    expect((await run([order])).unmatched).toBe(0)
    expect((await outbound(optA)).map((m) => m.quantity)).toEqual([1])
  })

  it('kstDay boundary', async () => {
    const late = po({
      orderId: `late-${TAG}`,
      paymentDate: `${DAY}T23:59:00+09:00`,
      skuMappings: [{ nsBarcode: BC_A, pickingQuantityPerOrder: 1 }],
    })
    const next = po({
      orderId: `next-${TAG}`,
      paymentDate: `${NEXT_DAY}T00:00:30+09:00`,
      skuMappings: [{ nsBarcode: BC_A, pickingQuantityPerOrder: 1 }],
    })
    const r = await run([late, next])
    expect(r.orders).toBe(1)
    const stored = await prisma.delOrder.findMany({ where: { spaceId, channelId: nbChannelId } })
    expect(stored.map((s) => s.orderNumber)).toEqual([late.orderId])
  })
})
