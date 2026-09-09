/**
 * 배송 묶음 완료 → 출고 위치 재고 차감 / 묶음 삭제 → 복원 e2e.
 *
 * 배경: 3PL 등 출고 위치가 설정된 배송 방식(DelShippingMethod.locationId)의 주문은
 * 배치 완료 시 위치 재고(InvStockLevel)를 차감해야 한다. 기존에는 channelStock만
 * 차감되고 위치 재고는 그대로라 3PL 재고가 항상 과대했다.
 *
 * 검증:
 *   1. 완료 시 optionId 직접 매칭 + fulfillment 팬아웃 합산 차감, delBatchId OUTBOUND 기록.
 *   2. 출고 위치 없는 배송 방식 주문은 차감 제외.
 *   3. 멱등 — 재호출해도 이중 차감 없음.
 *   4. 묶음 삭제(deleteBatchWithMovements) 시 재고 원상복구.
 *
 * throwaway Space, afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { applyBatchOutboundForBatch } from '../batch-outbound'
import { deleteBatchWithMovements } from '../batch-delete'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let optionAId = ''
let optionBId = ''
let batchId = ''

async function cleanup() {
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.delBatch.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.delShippingMethod.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

async function stock(optionId: string): Promise<number> {
  const row = await prisma.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  return row?.quantity ?? 0
}

const PII = {
  recipientNameEnc: 'x',
  recipientNameIv: 'x',
  phoneEnc: 'x',
  phoneIv: 'x',
  addressEnc: 'x',
  addressIv: 'x',
}

d('배송 묶음 출고 위치 재고 차감 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E BatchOutbound', type: 'PERSONAL' },
    })

    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 3PL', type: 'THIRD_PARTY', isActive: true },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 상품', groupId: group.id, status: 'ACTIVE' },
    })
    const optA = await prisma.invProductOption.create({
      data: { productId: product.id, name: '옵션A' },
    })
    const optB = await prisma.invProductOption.create({
      data: { productId: product.id, name: '옵션B' },
    })
    optionAId = optA.id
    optionBId = optB.id

    // 초기 재고: A=10, B=10
    await prisma.invStockLevel.createMany({
      data: [
        { spaceId: SPACE_ID, optionId: optionAId, locationId, quantity: 10 },
        { spaceId: SPACE_ID, optionId: optionBId, locationId, quantity: 10 },
      ],
    })

    const method3pl = await prisma.delShippingMethod.create({
      data: { spaceId: SPACE_ID, name: 'E2E 3PL 배송', formatConfig: [], locationId },
    })
    const methodPlain = await prisma.delShippingMethod.create({
      data: { spaceId: SPACE_ID, name: 'E2E 일반 택배', formatConfig: [] },
    })

    const batch = await prisma.delBatch.create({
      data: { spaceId: SPACE_ID, source: 'MANUAL', status: 'DRAFT' },
    })
    batchId = batch.id

    // 주문 1 (3PL): 옵션A 직접 매칭 qty 3 + fulfillment 팬아웃(A×2, B×1)
    const order1 = await prisma.delOrder.create({
      data: {
        spaceId: SPACE_ID,
        batchId,
        shippingMethodId: method3pl.id,
        orderDate: new Date(),
        ...PII,
      },
    })
    await prisma.delOrderItem.create({
      data: { orderId: order1.id, name: '옵션A 단품', quantity: 3, optionId: optionAId },
    })
    const bundleItem = await prisma.delOrderItem.create({
      data: { orderId: order1.id, name: '묶음상품', quantity: 1 },
    })
    await prisma.delOrderItemFulfillment.createMany({
      data: [
        { orderItemId: bundleItem.id, optionId: optionAId, quantity: 2 },
        { orderItemId: bundleItem.id, optionId: optionBId, quantity: 1 },
      ],
    })

    // 주문 2 (일반 택배 — 위치 미설정): 차감 제외 대상
    const order2 = await prisma.delOrder.create({
      data: {
        spaceId: SPACE_ID,
        batchId,
        shippingMethodId: methodPlain.id,
        orderDate: new Date(),
        ...PII,
      },
    })
    await prisma.delOrderItem.create({
      data: { orderId: order2.id, name: '옵션B 단품', quantity: 5, optionId: optionBId },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('완료 시 3PL 방식 주문만 옵션 합산 차감 + delBatchId OUTBOUND 기록', async () => {
    await prisma.$transaction((tx) => applyBatchOutboundForBatch(tx, SPACE_ID, batchId, new Date()))

    // A: 10 - (3 직접 + 2 fulfillment) = 5, B: 10 - 1 fulfillment = 9 (일반 택배 5개는 제외)
    expect(await stock(optionAId)).toBe(5)
    expect(await stock(optionBId)).toBe(9)

    const movements = await prisma.invMovement.findMany({ where: { delBatchId: batchId } })
    expect(movements).toHaveLength(2)
    expect(movements.every((m) => m.type === 'OUTBOUND' && m.locationId === locationId)).toBe(true)
    const byOption = new Map(movements.map((m) => [m.optionId, m.quantity]))
    expect(byOption.get(optionAId)).toBe(5)
    expect(byOption.get(optionBId)).toBe(1)
  })

  it('재호출해도 이중 차감 없음 (멱등)', async () => {
    await prisma.$transaction((tx) => applyBatchOutboundForBatch(tx, SPACE_ID, batchId, new Date()))
    expect(await stock(optionAId)).toBe(5)
    expect(await stock(optionBId)).toBe(9)
    expect(await prisma.invMovement.count({ where: { delBatchId: batchId } })).toBe(2)
  })

  it('묶음 삭제 시 재고 원상복구', async () => {
    const { deletedMovements } = await deleteBatchWithMovements(SPACE_ID, batchId)
    expect(deletedMovements).toBe(2)
    expect(await stock(optionAId)).toBe(10)
    expect(await stock(optionBId)).toBe(10)
    expect(await prisma.invMovement.count({ where: { spaceId: SPACE_ID } })).toBe(0)
  })
})
