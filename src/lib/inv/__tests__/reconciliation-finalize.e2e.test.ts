/**
 * 수동 확정(finalize) 경로 e2e — "매칭했는데 재고 숫자가 안 바뀐다" 회귀 방지.
 *
 * 핵심 검증:
 *   1. 선택 목록 없이도 matched-diff 차이 전량이 반영되고 CONFIRMED 로 잠긴다.
 *   2. matchResults 에 file-only 로 남아 있어도, 그 뒤 InvLocationProductMap 이 생겼으면
 *      확정이 그 매핑을 풀어 재고에 반영한다(사용자가 [상품 선택]/[SKU 연결]로 매칭한 경우).
 *   3. 매핑 수량 비율을 바꾼 뒤 확정하면 새 목표 수량이 재고에 도달한다.
 *   4. 확정된 대조는 재확정 불가.
 *   5. 확정은 system-only 를 0 으로 내리지 않는다(부재 ≠ 삭제 — 자동 대조 cron 전용).
 *
 * throwaway Space/User(고유 hex UUID), afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '../reconciliation-processor'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f5'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f6'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let diffOptionId = ''
let mappedOptionId = ''
let systemOnlyOptionId = ''

async function cleanup() {
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invReconciliation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invLocationProductMapItem.deleteMany({
    where: { map: { spaceId: SPACE_ID } },
  })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

/** 이 테스트 파일의 대조 레코드를 만든다. entries 는 matchResults JSON. */
async function createRecon(entries: unknown[]) {
  const recon = await prisma.invReconciliation.create({
    data: {
      spaceId: SPACE_ID,
      locationId,
      fileName: 'e2e-finalize.xlsx',
      snapshotDate: new Date('2026-02-01'),
      status: 'PENDING',
      matchResults: entries as never,
      totalItems: entries.length,
      matchedItems: 0,
    },
  })
  return recon.id
}

async function stockOf(optionId: string) {
  const row = await prisma.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  return row?.quantity ?? 0
}

d('수동 확정(finalize) 경로 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReconFinalize', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-recon-finalize@throwaway.test' },
    })

    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 창고', type: 'OWN', isActive: true },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 확정상품', groupId: group.id, status: 'ACTIVE' },
    })
    diffOptionId = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '차이옵션' } })
    ).id
    mappedOptionId = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '매핑옵션' } })
    ).id
    systemOnlyOptionId = (
      await prisma.invProductOption.create({
        data: { productId: product.id, name: '파일누락옵션' },
      })
    ).id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('선택 없이 matched-diff 전량 반영 + CONFIRMED 잠금', async () => {
    const reconId = await createRecon([
      {
        status: 'matched-diff',
        row: { externalCode: 'F-001', quantity: 40 },
        optionId: diffOptionId,
        locationId,
        productName: 'E2E 확정상품',
        optionName: '차이옵션',
        mapItemQuantity: 1,
        systemQuantity: 0,
        fileQuantity: 40,
        delta: 40,
      },
    ])

    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [], // 선택 목록이 비어 있어도 반영돼야 한다
      manualMappings: [],
      finalize: true,
    })

    expect(result.status).toBe('CONFIRMED')
    expect(result.adjustedCount).toBe(1)
    expect(await stockOf(diffOptionId)).toBe(40)

    const recon = await prisma.invReconciliation.findUnique({ where: { id: reconId } })
    expect(recon?.status).toBe('CONFIRMED')
    expect(recon?.confirmedAt).not.toBeNull()

    // 재확정 불가
    await expect(
      confirmReconciliation(SPACE_ID, reconId, {
        selectedOptionIds: [],
        manualMappings: [],
        finalize: true,
      })
    ).rejects.toThrow()
  })

  test('나중에 생긴 매핑도 확정이 풀어서 반영한다 (file-only → matched)', async () => {
    // 대조 시점에는 매칭 실패 → file-only 로 저장
    const reconId = await createRecon([
      {
        status: 'file-only',
        row: { externalCode: 'F-002', externalName: '외부상품', quantity: 7 },
        locationId,
        suggestions: [],
      },
    ])

    // 사용자가 나중에 매핑을 만든다 (UI 의 [상품 선택] / [쿠팡 SKU 연결] 에 해당)
    const map = await prisma.invLocationProductMap.create({
      data: { spaceId: SPACE_ID, locationId, externalCode: 'F-002', externalName: '외부상품' },
    })
    await prisma.invLocationProductMapItem.create({
      data: { mapId: map.id, optionId: mappedOptionId, quantity: 1 },
    })

    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      manualMappings: [],
      finalize: true,
    })

    expect(result.status).toBe('CONFIRMED')
    // matchResults 는 file-only 그대로지만 재고에는 반영돼야 한다
    expect(await stockOf(mappedOptionId)).toBe(7)
  })

  test('매핑 수량 비율을 바꾸면 새 목표 수량이 재고에 도달한다', async () => {
    // 앞 테스트에서 mappedOptionId 재고 = 7 (비율 1)
    const map = await prisma.invLocationProductMap.findUniqueOrThrow({
      where: { locationId_externalCode: { locationId, externalCode: 'F-002' } },
    })
    await prisma.invLocationProductMapItem.updateMany({
      where: { mapId: map.id, optionId: mappedOptionId },
      data: { quantity: 3 }, // 세트 3개입으로 수정
    })

    // 새 대조(= 새 referenceId) — 같은 스냅샷을 다시 확정하는 상황이 아니라
    // 매칭을 고친 뒤 다시 대조/확정하는 정상 흐름이다.
    const reconId = await createRecon([
      {
        status: 'file-only',
        row: { externalCode: 'F-002', externalName: '외부상품', quantity: 7 },
        locationId,
        suggestions: [],
      },
    ])

    await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      manualMappings: [],
      finalize: true,
    })

    expect(await stockOf(mappedOptionId)).toBe(21) // 7 × 3
  })

  test('확정은 system-only 를 0 으로 내리지 않는다', async () => {
    // 이 옵션에 재고를 만들어 둔다
    const seedRecon = await createRecon([
      {
        status: 'matched-diff',
        row: { externalCode: 'F-003', quantity: 12 },
        optionId: systemOnlyOptionId,
        locationId,
        productName: 'E2E 확정상품',
        optionName: '파일누락옵션',
        mapItemQuantity: 1,
        systemQuantity: 0,
        fileQuantity: 12,
        delta: 12,
      },
    ])
    await confirmReconciliation(SPACE_ID, seedRecon, {
      selectedOptionIds: [],
      manualMappings: [],
      finalize: true,
    })
    expect(await stockOf(systemOnlyOptionId)).toBe(12)

    // 이제 그 옵션이 파일에 없는 대조를 확정한다
    const reconId = await createRecon([
      {
        status: 'system-only',
        optionId: systemOnlyOptionId,
        locationId,
        productName: 'E2E 확정상품',
        optionName: '파일누락옵션',
        systemQuantity: 12,
      },
    ])
    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [],
      manualMappings: [],
      // 호출측이 켜도 확정 경로에서는 강제로 꺼져야 한다
      includeSystemOnly: true,
      finalize: true,
    })

    expect(result.status).toBe('CONFIRMED')
    expect(await stockOf(systemOnlyOptionId)).toBe(12) // 0 으로 죽지 않음
  })
})
