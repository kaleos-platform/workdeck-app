/**
 * 자동 재고 대조 — system-only 0 반영 + 스냅샷 완전성 판정 e2e.
 *
 * 핵심 검증:
 *   1. 기본(includeSystemOnly 미지정) — system-only 는 무시된다. 수동 대조 동작 불변.
 *   2. includeSystemOnly=true + 외부 SKU 매핑 있음 — 재고를 0 으로 내리고,
 *      calcApplicableCount 분모에도 포함돼 APPLIED 로 판정된다.
 *      → 분모 누락 시 이미 다 적용된 대조가 영영 PARTIAL 로 남는다.
 *   3. includeSystemOnly=true + 매핑 없음 — 0 처리하지 않고 unmappedSystemOnly 로 보고,
 *      PARTIAL 로 남겨 "쿠팡 SKU 연결 필요"를 화면에 표면화한다.
 *      → 매핑 없는 옵션은 소진인지 미연동인지 구별할 수 없다.
 *   4. getCoupangInventoryRows 완전성 판정 — 최근 최대 행수의 50% 미만이면 ok=false.
 *      자동 대조 cron 이 부분 export 를 반영하지 않게 막는 마지막 방어선.
 *
 * throwaway Space/User(고유 hex UUID), afterAll cascade 0-state 복원.
 * DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { confirmReconciliation } from '../reconciliation-processor'
import { processMovement } from '../movement-processor'
import { getCoupangInventoryRows } from '../reconciliation-sources'


const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000e2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const SNAPSHOT = new Date('2026-02-01T03:30:00.000Z')

let diffOptionId = ''
let goneOptionId = ''
let orphanOptionId = ''
let locationId = ''
let workspaceId = ''

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
  // Workspace/InventoryUpload/Record 는 User cascade 로 함께 삭제된다
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

/** matchResults 시드 — matched-diff 1건 + system-only 1건 */
function buildEntries() {
  return [
    {
      status: 'matched-diff',
      row: {
        externalCode: 'EXT-SO-001',
        externalName: 'E2E 대조상품',
        externalOptionName: '변동옵션',
        quantity: 100,
      },
      optionId: diffOptionId,
      locationId,
      productName: 'E2E 대조상품',
      optionName: '변동옵션',
      mapItemQuantity: 1,
      systemQuantity: 0,
      fileQuantity: 100,
      delta: 100,
    },
    {
      status: 'system-only',
      optionId: goneOptionId,
      locationId,
      productName: 'E2E 대조상품',
      optionName: '소진옵션',
      systemQuantity: 30,
    },
  ]
}

/** 외부 SKU 매핑이 없는 system-only 엔트리 — 자동 0 처리 대상에서 제외돼야 한다 */
function orphanEntry() {
  return {
    status: 'system-only',
    optionId: orphanOptionId,
    locationId,
    productName: 'E2E 대조상품',
    optionName: '미연동옵션',
    systemQuantity: 20,
  }
}

async function createRecon(opts: { withOrphan?: boolean } = {}) {
  const entries = opts.withOrphan ? [...buildEntries(), orphanEntry()] : buildEntries()
  const recon = await prisma.invReconciliation.create({
    data: {
      spaceId: SPACE_ID,
      locationId,
      fileName: 'e2e-system-only.xlsx',
      snapshotDate: SNAPSHOT,
      status: 'PENDING',
      matchResults: entries,
      totalItems: entries.length,
      matchedItems: 1,
    },
  })
  return recon.id
}

d('자동 재고 대조 system-only 0 반영 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E SystemOnly', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-recon-system-only@throwaway.test' },
    })

    const loc = await prisma.invStorageLocation.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 로켓그로스',
        type: 'THIRD_PARTY',
        isActive: true,
      },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 대조상품', groupId: group.id, status: 'ACTIVE' },
    })
    const diffOption = await prisma.invProductOption.create({
      data: { productId: product.id, name: '변동옵션' },
    })
    const goneOption = await prisma.invProductOption.create({
      data: { productId: product.id, name: '소진옵션' },
    })
    const orphanOption = await prisma.invProductOption.create({
      data: { productId: product.id, name: '미연동옵션' },
    })
    diffOptionId = diffOption.id
    goneOptionId = goneOption.id
    orphanOptionId = orphanOption.id

    // 소진옵션에만 외부 SKU 매핑을 만든다 — 미연동옵션은 매핑 없음
    const map = await prisma.invLocationProductMap.create({
      data: { spaceId: SPACE_ID, locationId, externalCode: 'EXT-SO-GONE' },
    })
    await prisma.invLocationProductMapItem.create({
      data: { mapId: map.id, optionId: goneOptionId, quantity: 1 },
    })

    // 두 옵션 모두 재고 시드 — 외부 스냅샷에는 없는 상태
    await processMovement(SPACE_ID, {
      type: 'INBOUND',
      optionId: goneOptionId,
      locationId,
      quantity: 30,
      movementDate: new Date('2026-01-15').toISOString(),
      reason: 'E2E 시드 입고',
    })
    await processMovement(SPACE_ID, {
      type: 'INBOUND',
      optionId: orphanOptionId,
      locationId,
      quantity: 20,
      movementDate: new Date('2026-01-15').toISOString(),
      reason: 'E2E 시드 입고 (미연동)',
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('기본 confirm: system-only 무시 — 소진옵션 재고 30 보존', async () => {
    const reconId = await createRecon()

    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [diffOptionId],
      manualMappings: [],
    })

    expect(result.adjustedCount).toBe(1)

    const gone = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: goneOptionId, locationId } },
    })
    expect(gone?.quantity).toBe(30)

    const diff = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: diffOptionId, locationId } },
    })
    expect(diff?.quantity).toBe(100)
  })

  test('includeSystemOnly=true + 매핑 있음: 소진옵션 0 처리 + APPLIED 판정 — 핵심 assertion', async () => {
    const reconId = await createRecon()

    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [diffOptionId],
      manualMappings: [],
      includeSystemOnly: true,
    })

    // matched-diff 1 + system-only(매핑 있음) 1 = 2 건 적용
    expect(result.adjustedCount).toBe(2)
    // 분모(calcApplicableCount)에 system-only 가 포함돼야 APPLIED 로 닫힌다
    expect(result.status).toBe('APPLIED')
    expect(result.unmappedSystemOnly).toBeUndefined()

    const gone = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: goneOptionId, locationId } },
    })
    expect(gone?.quantity).toBe(0)

    // 0 처리 movement 는 사유로 구분된다
    const zeroMove = await prisma.invMovement.findFirst({
      where: { referenceId: reconId, type: 'ADJUSTMENT', optionId: goneOptionId },
      select: { reason: true },
    })
    expect(zeroMove?.reason).toContain('외부 스냅샷 미존재')
  })

  test('매핑 없는 system-only 는 0 처리하지 않고 PARTIAL 로 표면화 — 핵심 assertion', async () => {
    const reconId = await createRecon({ withOrphan: true })

    const result = await confirmReconciliation(SPACE_ID, reconId, {
      selectedOptionIds: [diffOptionId],
      manualMappings: [],
      includeSystemOnly: true,
    })

    // 매핑 없는 1건은 적용 대상에서 빠지고 사용자 안내 대상으로 보고된다
    expect(result.unmappedSystemOnly).toBe(1)
    // 분모 3(diff 1 + system-only 2) > 적용 2 → PARTIAL 유지 = 목록에서 미완료로 표면화
    expect(result.status).toBe('PARTIAL')

    // 미연동옵션 재고 20 그대로 — 자동으로 죽지 않는다
    const orphan = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: orphanOptionId, locationId } },
    })
    expect(orphan?.quantity).toBe(20)

    const orphanMove = await prisma.invMovement.findFirst({
      where: { referenceId: reconId, type: 'ADJUSTMENT', optionId: orphanOptionId },
    })
    expect(orphanMove).toBeNull()
  })

  test('완전성 판정: 최근 최대 행수의 50% 미만이면 ok=false', async () => {
    const workspace = await prisma.workspace.create({
      data: { name: 'E2E 쿠팡', ownerId: USER_ID },
    })
    workspaceId = workspace.id

    // 정상 규모 이력 (100행) — baseline 앵커
    await prisma.inventoryUpload.create({
      data: {
        workspaceId,
        fileName: 'normal.xlsx',
        fileType: 'INVENTORY_HEALTH',
        snapshotDate: new Date('2026-01-30T03:30:00.000Z'),
        totalRows: 100,
        insertedRows: 100,
      },
    })

    // 부분 export (2행) — 최신 스냅샷
    const partial = await prisma.inventoryUpload.create({
      data: {
        workspaceId,
        fileName: 'partial.xlsx',
        fileType: 'INVENTORY_HEALTH',
        snapshotDate: SNAPSHOT,
        totalRows: 2,
        insertedRows: 2,
      },
    })
    await prisma.inventoryRecord.createMany({
      data: [0, 1].map((i) => ({
        workspaceId,
        uploadId: partial.id,
        snapshotDate: SNAPSHOT,
        fileType: 'INVENTORY_HEALTH',
        productId: `P${i}`,
        optionId: `O${i}`,
        skuId: `S${i}`,
        productName: `부분상품${i}`,
        availableStock: 5,
      })),
    })

    const parsed = await getCoupangInventoryRows(workspaceId)

    expect(parsed.rows).toHaveLength(2)
    expect(parsed.completeness.baseline).toBe(100)
    expect(parsed.completeness.ok).toBe(false)
  })
})
