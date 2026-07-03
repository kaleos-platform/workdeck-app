/** @jest-environment node */
/**
 * 세트 조립·이관 processSetTransfer — dev DB 통합 E2E.
 *
 * 전용 throwaway space에 옵션·위치·재고를 직접 시드하고 processSetTransfer 를 호출해
 * 정적 분석으로는 검증 불가한 런타임 동작을 확인한다:
 *   (1) 자체창고 차감 + FC 가산이 정확히 요청량(setQty×perSet)만큼,
 *   (2) 한 옵션이라도 부족하면 어떤 write 도 없이 전량 차단(all-or-nothing 원자성),
 *   (3) 출발지=도착지 거부.
 * afterAll 에서 space cascade 로 0-state 복원. DATABASE_URL/DIRECT_URL 없으면 describe.skip.
 *
 * 실행: npx jest --config jest.config.e2e.ts src/lib/inv/__tests__/set-transfer.e2e.test.ts
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { processSetTransfer, MovementError } from '@/lib/inv/movement-processor'

// 전용 throwaway space — 실 데이터를 절대 건드리지 않도록 격리. cascade 로 모든 하위 행 정리.
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000a1'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let ownId = ''
let fcId = ''
let blackId = ''
let whiteId = ''

async function stockOf(optionId: string, locationId: string): Promise<number> {
  const row = await prisma.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  return row?.quantity ?? 0
}

async function setStock(optionId: string, locationId: string, quantity: number) {
  await prisma.invStockLevel.upsert({
    where: { optionId_locationId: { optionId, locationId } },
    update: { quantity },
    create: { spaceId: SPACE_ID, optionId, locationId, quantity },
  })
}

async function cleanup() {
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

d('processSetTransfer 통합 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E SetTransfer Throwaway', type: 'PERSONAL' },
    })
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 캡나시', groupId: group.id },
    })
    const black = await prisma.invProductOption.create({
      data: { productId: product.id, name: '블랙' },
    })
    const white = await prisma.invProductOption.create({
      data: { productId: product.id, name: '화이트' },
    })
    blackId = black.id
    whiteId = white.id
    const own = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 자체창고', type: 'OWN' },
    })
    const fc = await prisma.invStorageLocation.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 로켓그로스',
        type: 'THIRD_PARTY',
        externalSource: 'e2e_rocket_growth',
      },
    })
    ownId = own.id
    fcId = fc.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // 각 케이스 전 재고·이동 초기화: 자체창고 블랙10·화이트10, FC 0
    await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
    await setStock(blackId, ownId, 10)
    await setStock(whiteId, ownId, 10)
    await setStock(blackId, fcId, 0)
    await setStock(whiteId, fcId, 0)
  })

  test('정상 조립·이관 — 자체창고 차감 + FC 가산이 정확히 요청량만큼', async () => {
    // 세트 3개 = 블랙×2 + 화이트×1 → 블랙 6, 화이트 3 이관
    const result = await processSetTransfer(SPACE_ID, {
      components: [
        { optionId: blackId, quantity: 6 },
        { optionId: whiteId, quantity: 3 },
      ],
      fromLocationId: ownId,
      toLocationId: fcId,
      movementDate: '2026-06-30',
      reason: 'E2E 정상 이관',
      referenceId: 'setxfer:e2e-ok',
    })

    expect(result.movements).toHaveLength(2)
    expect(await stockOf(blackId, ownId)).toBe(4)
    expect(await stockOf(whiteId, ownId)).toBe(7)
    expect(await stockOf(blackId, fcId)).toBe(6)
    expect(await stockOf(whiteId, fcId)).toBe(3)

    const movements = await prisma.invMovement.findMany({
      where: { spaceId: SPACE_ID, type: 'TRANSFER' },
    })
    expect(movements).toHaveLength(2)
    expect(movements.every((m) => m.locationId === ownId && m.toLocationId === fcId)).toBe(true)
    expect(movements.every((m) => m.referenceId === 'setxfer:e2e-ok')).toBe(true)
  })

  test('조립 초과 — 한 옵션이라도 부족하면 전량 차단(all-or-nothing)', async () => {
    await setStock(whiteId, ownId, 2) // 화이트 부족 (필요 3 > 보유 2)

    await expect(
      processSetTransfer(SPACE_ID, {
        components: [
          { optionId: blackId, quantity: 6 },
          { optionId: whiteId, quantity: 3 },
        ],
        fromLocationId: ownId,
        toLocationId: fcId,
        movementDate: '2026-06-30',
        referenceId: 'setxfer:e2e-short',
      })
    ).rejects.toThrow(MovementError)

    // 어떤 재고도 변하지 않아야 함 — 충분했던 블랙도 차감되면 안 됨
    expect(await stockOf(blackId, ownId)).toBe(10)
    expect(await stockOf(whiteId, ownId)).toBe(2)
    expect(await stockOf(blackId, fcId)).toBe(0)
    expect(await stockOf(whiteId, fcId)).toBe(0)

    const movements = await prisma.invMovement.findMany({
      where: { spaceId: SPACE_ID, type: 'TRANSFER' },
    })
    expect(movements).toHaveLength(0)
  })

  test('출발지=도착지면 거부', async () => {
    await expect(
      processSetTransfer(SPACE_ID, {
        components: [{ optionId: blackId, quantity: 1 }],
        fromLocationId: ownId,
        toLocationId: ownId,
        movementDate: '2026-06-30',
      })
    ).rejects.toThrow(MovementError)
    expect(await stockOf(blackId, ownId)).toBe(10)
  })
})
