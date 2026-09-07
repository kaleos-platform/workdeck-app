/**
 * 같은 내부 옵션을 여러 외부 SKU 가 가리킬 때의 옵션 단위 합산 e2e.
 *
 * 배경: 1장 / 3장 세트 / 5장 세트 SKU 가 모두 같은 옵션을 가리킨다. 매처는 행 단위로
 * 엔트리를 만들고 각 엔트리가 독립적인 fileQuantity 를 갖는데, ADJUSTMENT 는 절대량 set
 * 이라 순차 적용하면 하나만 남고 나머지는 버려진다 → 확정해도 재고가 안 맞고 재대조하면
 * 같은 차이가 다시 뜬다.
 *
 * 검증:
 *   1. 목표 재고 = Σ(파일수량 × 세트비율), ADJUSTMENT 는 옵션당 1건.
 *   2. 확정 후 같은 파일로 재대조하면 차이가 없다(회귀 핵심).
 *   3. 행별로는 차이여도 합계가 시스템 재고와 같으면 movement 0건.
 *   4. cron 경로(finalize 미지정 + selectedOptionIds)에서도 합산값 1건.
 *   5. 다중 SKU 옵션 세션도 confirm 후 APPLIED 가 된다(영구 PARTIAL 회귀).
 *   6. 불변식 — 그룹 멤버의 systemQuantity 는 동일하다.
 *   7. 수동 매핑이 기존 matched 그룹과 같은 옵션을 가리키면 합산되어 1건.
 *
 * throwaway Space/User, afterAll cascade 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '../reconciliation-processor'
import { aggregateMatchedByOption } from '../reconciliation-resolve'
import { matchReconciliation } from '../reconciliation-matcher'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let optionId = ''
let otherOptionId = ''

const SKU_SINGLE = 'E2E-SKU-1'
const SKU_SET3 = 'E2E-SKU-3'
const SKU_SET5 = 'E2E-SKU-5'
const SKU_MANUAL = 'E2E-SKU-MANUAL'

async function cleanup() {
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invReconciliation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invLocationProductMapItem.deleteMany({ where: { map: { spaceId: SPACE_ID } } })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

/** externalCode → (optionId, 세트비율) 매핑 생성 */
async function createMapping(
  externalCode: string,
  items: { optionId: string; quantity: number }[]
) {
  const map = await prisma.invLocationProductMap.create({
    data: { spaceId: SPACE_ID, locationId, externalCode, externalName: externalCode },
  })
  await prisma.invLocationProductMapItem.createMany({
    data: items.map((i) => ({ mapId: map.id, optionId: i.optionId, quantity: i.quantity })),
  })
  return map.id
}

async function setStock(target: string, quantity: number) {
  await prisma.invStockLevel.upsert({
    where: { optionId_locationId: { optionId: target, locationId } },
    create: { spaceId: SPACE_ID, optionId: target, locationId, quantity },
    update: { quantity },
  })
}

async function stockOf(target: string) {
  const row = await prisma.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId: target, locationId } },
  })
  return row?.quantity ?? 0
}

/** 파일 행 → matchReconciliation 으로 실제 매칭 결과를 얻는다(매처 규칙 그대로). */
async function matchRows(rows: { externalCode: string; quantity: number }[]) {
  return matchReconciliation(SPACE_ID, locationId, {
    format: 'coupang_health',
    rows: rows.map((r) => ({ externalCode: r.externalCode, quantity: r.quantity })),
    snapshotDate: new Date('2026-03-01'),
  } as never)
}

async function createRecon(entries: unknown[], fileName = 'e2e-multi-sku.xlsx') {
  const recon = await prisma.invReconciliation.create({
    data: {
      spaceId: SPACE_ID,
      locationId,
      fileName,
      snapshotDate: new Date('2026-03-01'),
      status: 'PENDING',
      matchResults: entries as never,
      totalItems: entries.length,
      matchedItems: entries.length,
    },
  })
  return recon.id
}

async function adjustmentsOf(reconciliationId: string) {
  return prisma.invMovement.findMany({
    where: { referenceId: reconciliationId, type: 'ADJUSTMENT' },
    select: { optionId: true, quantity: true },
  })
}

d('다중 외부 SKU → 단일 옵션 합산 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReconMultiSku', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-recon-multisku@throwaway.test' } })

    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 로켓그로스', type: 'THIRD_PARTY', isActive: true },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 팬티', groupId: group.id, status: 'ACTIVE' },
    })
    optionId = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '블랙 / L' } })
    ).id
    otherOptionId = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '블랙 / M' } })
    ).id

    // 1장 ×1, 3장 세트 ×3, 5장 세트 ×5 — 모두 같은 옵션을 가리킨다.
    await createMapping(SKU_SINGLE, [{ optionId, quantity: 1 }])
    await createMapping(SKU_SET3, [{ optionId, quantity: 3 }])
    await createMapping(SKU_SET5, [{ optionId, quantity: 5 }])
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.invReconciliation.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  it('1) 목표 재고 = Σ(파일수량 × 세트비율), ADJUSTMENT 는 옵션당 1건', async () => {
    await setStock(optionId, 20)
    // 10×1 + 5×3 + 2×5 = 35
    const { entries } = await matchRows([
      { externalCode: SKU_SINGLE, quantity: 10 },
      { externalCode: SKU_SET3, quantity: 5 },
      { externalCode: SKU_SET5, quantity: 2 },
    ])
    expect(entries.filter((e) => e.status.startsWith('matched')).length).toBe(3)

    const reconId = await createRecon(entries)
    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      finalize: true,
      manualMappings: [],
    })

    expect(result.status).toBe('CONFIRMED')
    const movements = await adjustmentsOf(reconId)
    expect(movements).toHaveLength(1)
    expect(movements[0].optionId).toBe(optionId)
    expect(movements[0].quantity).toBe(15) // delta = 35 - 20
    expect(await stockOf(optionId)).toBe(35)
  })

  it('2) 확정 후 같은 파일로 재대조하면 차이가 없다', async () => {
    await setStock(optionId, 20)
    const rows = [
      { externalCode: SKU_SINGLE, quantity: 10 },
      { externalCode: SKU_SET3, quantity: 5 },
      { externalCode: SKU_SET5, quantity: 2 },
    ]
    const first = await matchRows(rows)
    const reconId = await createRecon(first.entries)
    await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      finalize: true,
      manualMappings: [],
    })
    expect(await stockOf(optionId)).toBe(35)

    // 재대조 — 재고 35, 파일 그대로
    const second = await matchRows(rows)
    const grouped = aggregateMatchedByOption(second.entries, locationId)
    const matchedRows = grouped.filter((e) => e.status.startsWith('matched'))
    expect(matchedRows).toHaveLength(3)
    expect(matchedRows.every((e) => e.status === 'matched-equal')).toBe(true)
    // 확정 대상(옵션 단위) 0건
    expect(grouped.filter((e) => e.status === 'matched-diff')).toHaveLength(0)
  })

  it('3) 행별로는 차이여도 합계가 같으면 movement 0건', async () => {
    await setStock(optionId, 35)
    const { entries } = await matchRows([
      { externalCode: SKU_SINGLE, quantity: 10 }, // 행 단위: 10 vs 35 → diff
      { externalCode: SKU_SET3, quantity: 5 }, // 15 vs 35 → diff
      { externalCode: SKU_SET5, quantity: 2 }, // 10 vs 35 → diff
    ])
    expect(entries.filter((e) => e.status === 'matched-diff')).toHaveLength(3)

    const reconId = await createRecon(entries)
    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      finalize: true,
      manualMappings: [],
    })
    expect(result.status).toBe('CONFIRMED')
    expect(await adjustmentsOf(reconId)).toHaveLength(0)
    expect(await stockOf(optionId)).toBe(35)
  })

  it('4) cron 경로(부분 적용)에서도 합산값이 1건으로 적용된다', async () => {
    await setStock(optionId, 20)
    const { entries } = await matchRows([
      { externalCode: SKU_SINGLE, quantity: 10 },
      { externalCode: SKU_SET3, quantity: 5 },
      { externalCode: SKU_SET5, quantity: 2 },
    ])
    const reconId = await createRecon(entries)
    // finalize 없이 optionId 선택 — cron 계약
    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [optionId],
      manualMappings: [],
    })

    const movements = await adjustmentsOf(reconId)
    expect(movements).toHaveLength(1)
    expect(await stockOf(optionId)).toBe(35)
    // 5) 적용 가능 총수도 옵션 단위 → 전부 적용됐으므로 APPLIED
    expect(result.status).toBe('APPLIED')
  })

  it('6) 그룹 멤버의 systemQuantity 는 동일하다(불변식)', async () => {
    await setStock(optionId, 7)
    const { entries } = await matchRows([
      { externalCode: SKU_SINGLE, quantity: 1 },
      { externalCode: SKU_SET3, quantity: 1 },
      { externalCode: SKU_SET5, quantity: 1 },
    ])
    const grouped = aggregateMatchedByOption(entries, locationId)
    const members = grouped.filter(
      (e): e is Extract<typeof e, { status: 'matched-diff' | 'matched-equal' }> =>
        (e.status === 'matched-diff' || e.status === 'matched-equal') &&
        e.groupKey === `${locationId}|${optionId}`
    )
    expect(members).toHaveLength(3)
    expect(new Set(members.map((e) => e.systemQuantity)).size).toBe(1)
    expect(new Set(members.map((e) => e.groupFileQuantity))).toEqual(new Set([9])) // 1+3+5
    expect(members.filter((e) => e.isGroupPrimary)).toHaveLength(1)
  })

  it('7) 수동 매핑이 같은 옵션을 가리키면 matched 그룹에 합산된다', async () => {
    await setStock(optionId, 0)
    const { entries } = await matchRows([
      { externalCode: SKU_SINGLE, quantity: 4 },
      { externalCode: SKU_MANUAL, quantity: 3 }, // 매핑 없음 → file-only
    ])
    expect(entries.filter((e) => e.status === 'file-only')).toHaveLength(1)

    const reconId = await createRecon(entries)
    await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      finalize: true,
      manualMappings: [{ externalCode: SKU_MANUAL, items: [{ optionId, quantity: 2 }] }],
    })

    const movements = await adjustmentsOf(reconId)
    expect(movements).toHaveLength(1)
    // 4×1 (matched) + 3×2 (수동) = 10
    expect(await stockOf(optionId)).toBe(10)
  })

  it('8) 다른 옵션은 서로 섞이지 않는다', async () => {
    await setStock(optionId, 0)
    await setStock(otherOptionId, 0)
    await createMapping('E2E-SKU-OTHER', [{ optionId: otherOptionId, quantity: 1 }])
    const { entries } = await matchRows([
      { externalCode: SKU_SINGLE, quantity: 4 },
      { externalCode: 'E2E-SKU-OTHER', quantity: 9 },
    ])
    const reconId = await createRecon(entries)
    await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      finalize: true,
      manualMappings: [],
    })
    expect(await stockOf(optionId)).toBe(4)
    expect(await stockOf(otherOptionId)).toBe(9)
  })
})
