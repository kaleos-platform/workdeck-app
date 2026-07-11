/**
 * upsertStockLevel 첫 행 동시 INSERT 직렬화 e2e.
 *
 * 동일 (optionId, locationId) 쌍으로 Promise.all([INBOUND, INBOUND]) 시
 * 둘 다 성공(P2002 없음), InvStockLevel 1행 + 수량 합산 정확, InvMovement 2행.
 * advisory lock 없으면 한쪽이 P2002 unique constraint 위반으로 500 → red.
 *
 * throwaway space + option/location, afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { processMovement } from '@/lib/inv/movement-processor'

// throwaway — 다른 e2e와 충돌 없도록 고유 hex UUID 사용
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000ef101'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)

let optionId: string
let locationId: string

describe('upsertStockLevel — 첫 행 동시 INSERT 직렬화', () => {
  beforeAll(async () => {
    if (!RUN) return
    await cleanupThrowaway()

    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E StockLevelConcurrent' } })

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 동시입고상품', groupId: group.id, status: 'ACTIVE' },
    })
    const option = await prisma.invProductOption.create({
      data: { productId: product.id, name: '기본옵션', sku: null },
    })
    optionId = option.id

    const location = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 창고', type: 'OWN' },
    })
    locationId = location.id
  })

  afterAll(async () => {
    if (!RUN) return
    await cleanupThrowaway()
    await prisma.$disconnect()
  })

  it('두 동시 INBOUND가 모두 성공, InvStockLevel 1행·수량 합산, InvMovement 2행', async () => {
    if (!RUN) {
      console.warn('DATABASE_URL 미설정 — e2e 건너뜀')
      return
    }

    const input = {
      type: 'INBOUND' as const,
      optionId,
      locationId,
      quantity: 10,
      movementDate: new Date().toISOString(),
    }

    // 동시 첫 INSERT — advisory lock 없으면 P2002로 한쪽 실패
    const [r1, r2] = await Promise.all([
      processMovement(SPACE_ID, input),
      processMovement(SPACE_ID, input),
    ])

    // 둘 다 성공(예외 없음)
    expect(r1).toBeDefined()
    expect(r2).toBeDefined()

    // InvStockLevel 정확 1행
    const levels = await prisma.invStockLevel.findMany({
      where: { optionId, locationId },
    })
    expect(levels).toHaveLength(1)

    // 수량 합산 정확 (10 + 10)
    expect(levels[0].quantity).toBe(20)

    // InvMovement 정확 2행
    const movements = await prisma.invMovement.findMany({
      where: { optionId, locationId, spaceId: SPACE_ID, type: 'INBOUND' },
    })
    expect(movements).toHaveLength(2)
  })
})

async function cleanupThrowaway() {
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}
