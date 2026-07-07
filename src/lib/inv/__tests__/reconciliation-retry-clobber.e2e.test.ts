/**
 * 재고 대조 확정 재시도 clobber 방지 e2e — confirmReconciliation PARTIAL 재시도 안전망.
 *
 * 핵심 검증:
 *   1. 첫 번째 confirmReconciliation 호출이 ADJUSTMENT movement를 정확히 1건 생성한다.
 *   2. 중간 INBOUND(+50)로 재고가 변경된 뒤 재시도 confirmReconciliation을 호출해도
 *      이미 적용된 (optionId, locationId) 건이 재적용되지 않아 재고가 보존된다(150 유지).
 *      → 수정 없으면 ADJUSTMENT 재적용 → 재고 100으로 clobber + movement 2건.
 *
 * throwaway Space/User(고유 hex UUID), afterAll cascade 0-state 복원.
 * DB URL 없으면 skip. confirmReconciliation은 lib 직접 호출(route mock 불필요).
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '../reconciliation-processor'
import { processMovement } from '../movement-processor'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let optionId = ''
let locationId = ''
let reconId = ''

async function cleanup() {
  // InvMovement cascade는 InvStorageLocation → Cascade 이지만 명시 삭제로 순서 보장
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invReconciliation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

d('confirmReconciliation 재시도 clobber 방지 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // Space + User 생성
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReconClobber', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-recon-clobber@throwaway.test' },
    })

    // 보관 장소 생성
    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 창고', type: 'OWN', isActive: true },
    })
    locationId = loc.id

    // 상품 그룹 → 상품 → 옵션
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 대조상품',
        groupId: group.id,
        status: 'ACTIVE',
      },
    })
    const option = await prisma.invProductOption.create({
      data: { productId: product.id, name: '기본옵션' },
    })
    optionId = option.id

    // matchResults: matched-diff entry (fileQuantity=100)
    const matchResults = [
      {
        status: 'matched-diff',
        row: {
          externalCode: 'EXT-001',
          externalName: 'E2E 대조상품',
          externalOptionName: '기본옵션',
          quantity: 100,
        },
        optionId,
        locationId,
        productName: 'E2E 대조상품',
        optionName: '기본옵션',
        mapItemQuantity: 1,
        systemQuantity: 0,
        fileQuantity: 100,
        delta: 100,
      },
    ]

    // InvReconciliation 시드
    const recon = await prisma.invReconciliation.create({
      data: {
        spaceId: SPACE_ID,
        locationId,
        fileName: 'e2e-test.xlsx',
        snapshotDate: new Date('2026-01-01'),
        status: 'PENDING',
        matchResults,
        totalItems: 1,
        matchedItems: 1,
      },
    })
    reconId = recon.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('1차 확정: ADJUSTMENT 1건 생성 + 재고 100', async () => {
    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [optionId],
      manualMappings: [],
    })

    expect(result.adjustedCount).toBe(1)

    // ADJUSTMENT movement 정확히 1건
    const movements = await prisma.invMovement.findMany({
      where: { referenceId: reconId, type: 'ADJUSTMENT' },
    })
    expect(movements).toHaveLength(1)

    // 재고 100 (스냅샷 fileQuantity)
    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(100)
  })

  test('중간 INBOUND +50 → 재고 150', async () => {
    await processMovement(SPACE_ID, {
      type: 'INBOUND',
      optionId,
      locationId,
      quantity: 50,
      movementDate: new Date('2026-01-02').toISOString(),
      reason: '중간 입고 (재시도 clobber 테스트)',
    })

    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(150)
  })

  test('재시도 확정: ADJUSTMENT 여전히 1건 + 재고 150 보존 (clobber 없음) — 핵심 assertion', async () => {
    // reconciliation 상태를 PARTIAL로 전환해야 재시도 가능
    await prisma.invReconciliation.update({
      where: { id: reconId },
      data: { status: 'PARTIAL' },
    })

    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [optionId],
      manualMappings: [],
    })

    // 재시도 후에도 누적 적용 1건 유지
    expect(result.adjustedCount).toBe(1)

    // ADJUSTMENT movement 여전히 정확히 1건 (재적용 없음)
    const movements = await prisma.invMovement.findMany({
      where: { referenceId: reconId, type: 'ADJUSTMENT' },
    })
    expect(movements).toHaveLength(1)

    // 핵심: 중간 INBOUND가 보존됨 — 스냅샷 100으로 clobber 되지 않음
    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(150)
  })
})
