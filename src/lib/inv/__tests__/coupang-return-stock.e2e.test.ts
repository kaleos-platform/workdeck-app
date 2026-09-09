/**
 * 반품 등급 재고 파생 헬퍼 e2e.
 *
 * 쿠팡은 고객 반품품을 등급 매겨 별도 상품으로 재등록한다. 그 재고는 반품 전용
 * 리스팅에서만 팔려 정상 상품 수요를 메우지 못하므로, 재고 현황에는 포함하되
 * 발주 계산에서는 빼야 한다. 이 헬퍼가 그 "얼마를 뺄지"를 계산한다.
 *
 * 검증:
 *   1. 반품 행만 집계하고 NEW 는 무시한다
 *   2. 세트 비율(mapItemQuantity)로 환산한다 — 대조 Σ 와 같은 규칙
 *   3. externalCode 가 skuId 아닌 optionId/productId 로 저장된 옛 매핑도 해석된다
 *   4. 재고가 채워진 최신 스냅샷을 고른다(재고 null 인 API 스냅샷은 건너뜀)
 *   5. 쿠팡 미연동 space 는 null
 *
 * throwaway Space/Workspace, afterAll cascade 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { getCoupangReturnStockByOption } from '../coupang-return-stock'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '../external-sources'
import { queryStockStatus } from '@/lib/sh/queries'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000e2'
const WS_ID = 'e2e00000-0000-4000-8000-0000000000e3'
const BARE_SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e4'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const OLD_SNAP = new Date('2026-07-01T00:00:00.000Z')
const NEW_SNAP = new Date('2026-07-02T00:00:00.000Z')

let locationId = ''
let optSingle = ''
let optSet = ''
let optLegacy = ''

async function cleanup() {
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invLocationProductMapItem.deleteMany({ where: { map: { spaceId: SPACE_ID } } })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.workspace.deleteMany({ where: { id: WS_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, BARE_SPACE_ID] } } })
}

/** 스냅샷별 InventoryUpload 를 1개만 만들어 재사용한다(InventoryRecord.uploadId 필수). */
const uploadIdBySnap = new Map<number, string>()
async function ensureUpload(snapshotDate: Date, source: 'CRAWL' | 'API' = 'CRAWL') {
  const key = snapshotDate.getTime()
  const cached = uploadIdBySnap.get(key)
  if (cached) return cached
  const up = await prisma.inventoryUpload.create({
    data: {
      workspaceId: WS_ID,
      fileName: `e2e-${key}.xlsx`,
      fileType: 'INVENTORY_HEALTH',
      snapshotDate,
      totalRows: 1,
      insertedRows: 1,
      source,
    },
  })
  uploadIdBySnap.set(key, up.id)
  return up.id
}

async function addRecord(opts: {
  snapshotDate: Date
  productId: string
  optionId: string
  skuId: string | null
  grade: string | null
  stock: number | null
}) {
  const uploadId = await ensureUpload(opts.snapshotDate)
  await prisma.inventoryRecord.create({
    data: {
      workspaceId: WS_ID,
      uploadId,
      snapshotDate: opts.snapshotDate,
      fileType: 'INVENTORY_HEALTH',
      productId: opts.productId,
      optionId: opts.optionId,
      skuId: opts.skuId,
      productName: '테스트 상품',
      productGrade: opts.grade,
      availableStock: opts.stock,
    },
  })
}

async function addMapping(externalCode: string, items: { optionId: string; quantity: number }[]) {
  const map = await prisma.invLocationProductMap.create({
    data: { spaceId: SPACE_ID, locationId, externalCode, externalName: externalCode },
  })
  await prisma.invLocationProductMapItem.createMany({
    data: items.map((i) => ({ mapId: map.id, optionId: i.optionId, quantity: i.quantity })),
  })
}

d('반품 등급 재고 파생 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E ReturnStock', type: 'PERSONAL' } })
    await prisma.space.create({
      data: { id: BARE_SPACE_ID, name: 'E2E NoCoupang', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-returnstock@throwaway.test' } })
    await prisma.workspace.create({ data: { id: WS_ID, ownerId: USER_ID, name: 'E2E RS WS' } })

    const loc = await prisma.invStorageLocation.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 쿠팡 로켓그로스',
        type: 'THIRD_PARTY',
        isActive: true,
        externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
        externalIntegrationKey: WS_ID,
      },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 상품', groupId: group.id, status: 'ACTIVE' },
    })
    optSingle = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '단품옵션' } })
    ).id
    optSet = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '세트옵션' } })
    ).id
    optLegacy = (
      await prisma.invProductOption.create({ data: { productId: product.id, name: '구매핑옵션' } })
    ).id

    // 재고가 채워진 최신 스냅샷(NEW_SNAP)
    await addRecord({
      snapshotDate: NEW_SNAP,
      productId: 'P1',
      optionId: 'O1',
      skuId: 'SKU-NEW',
      grade: 'NEW',
      stock: 100,
    })
    await addRecord({
      snapshotDate: NEW_SNAP,
      productId: 'P2',
      optionId: 'O2',
      skuId: 'SKU-RET',
      grade: '반품-최상',
      stock: 7,
    })
    await addRecord({
      snapshotDate: NEW_SNAP,
      productId: 'P3',
      optionId: 'O3',
      skuId: 'SKU-RET-SET',
      grade: '반품-상',
      stock: 2,
    })
    // skuId 가 없어 옛 매핑이 optionId 로 저장된 케이스
    await addRecord({
      snapshotDate: NEW_SNAP,
      productId: 'P4',
      optionId: 'O4',
      skuId: null,
      grade: '반품-중',
      stock: 5,
    })
    // 더 오래된 스냅샷 — 선택되면 안 된다
    await addRecord({
      snapshotDate: OLD_SNAP,
      productId: 'P2',
      optionId: 'O2',
      skuId: 'SKU-RET',
      grade: '반품-최상',
      stock: 999,
    })

    await addMapping('SKU-NEW', [{ optionId: optSingle, quantity: 1 }])
    await addMapping('SKU-RET', [{ optionId: optSingle, quantity: 1 }])
    await addMapping('SKU-RET-SET', [{ optionId: optSet, quantity: 3 }])
    await addMapping('O4', [{ optionId: optLegacy, quantity: 1 }])
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('1·2·3) 반품만 집계하고 세트 비율로 환산하며 옛 매핑도 해석한다', async () => {
    const res = await getCoupangReturnStockByOption(SPACE_ID)
    expect(res).not.toBeNull()
    expect(res!.locationId).toBe(locationId)
    expect(res!.snapshotDate.getTime()).toBe(NEW_SNAP.getTime())
    // NEW 100 은 집계되지 않는다
    expect(res!.byOption.get(optSingle)).toBe(7)
    // 반품 2개 × 세트비율 3 = 6
    expect(res!.byOption.get(optSet)).toBe(6)
    // skuId 없이 optionId 로 매핑된 건도 잡힌다
    expect(res!.byOption.get(optLegacy)).toBe(5)
  })

  it('4) 재고가 null 인 최신 스냅샷은 건너뛰고 재고 있는 스냅샷을 고른다', async () => {
    const apiSnap = new Date('2026-07-03T00:00:00.000Z')
    await addRecord({
      snapshotDate: apiSnap,
      productId: 'P2',
      optionId: 'O2',
      skuId: 'SKU-RET',
      grade: null,
      stock: null,
    })
    try {
      const res = await getCoupangReturnStockByOption(SPACE_ID)
      expect(res!.snapshotDate.getTime()).toBe(NEW_SNAP.getTime())
      expect(res!.byOption.get(optSingle)).toBe(7)
    } finally {
      await prisma.inventoryRecord.deleteMany({
        where: { workspaceId: WS_ID, snapshotDate: apiSnap },
      })
      await prisma.inventoryUpload.deleteMany({
        where: { workspaceId: WS_ID, snapshotDate: apiSnap },
      })
      uploadIdBySnap.delete(apiSnap.getTime())
    }
  })

  it('5) 쿠팡 미연동 space 는 null', async () => {
    expect(await getCoupangReturnStockByOption(BARE_SPACE_ID)).toBeNull()
  })

  it('6) queryStockStatus 는 opt-in 일 때만 반품을 내려준다 (MCP 경로 회귀)', async () => {
    // 이 쿼리는 MCP 툴과 공유된다 — 기본값으로 조인 비용이 얹히면 안 된다.
    const off = (await queryStockStatus(SPACE_ID)) as { returnStock?: unknown }
    expect(off.returnStock).toBeUndefined()

    const on = (await queryStockStatus(SPACE_ID, { includeReturnStock: true })) as {
      returnStock?: { locationId: string; snapshotDate: string }
    }
    expect(on.returnStock?.locationId).toBe(locationId)
    expect(on.returnStock?.snapshotDate).toBe(NEW_SNAP.toISOString())
  })

  it('8) 등급 없는 API 스냅샷이 최신이어도 반품 차감이 살아있다 (회귀)', async () => {
    // Open API 수집분은 재고는 주지만 상품등급을 안 준다. 등급과 재고를 같은
    // 스냅샷에서 읽으면 API 가 최신인 순간 반품 구분이 통째로 사라진다
    // (2026-09-08 prod 실측으로 실제 발생). 등급은 별도 스냅샷에서 가져온다.
    const apiSnap = new Date('2026-07-05T00:00:00.000Z')
    const upId = await ensureUpload(apiSnap, 'API')
    await prisma.inventoryRecord.createMany({
      data: [
        // 등급 없이, 재고만. CRAWL 스냅샷과 같은 SKU 들이다.
        {
          workspaceId: WS_ID,
          uploadId: upId,
          snapshotDate: apiSnap,
          fileType: 'INVENTORY_HEALTH',
          productId: 'P2',
          optionId: 'O2',
          skuId: 'SKU-RET',
          productName: 'x',
          availableStock: 7,
        },
        {
          workspaceId: WS_ID,
          uploadId: upId,
          snapshotDate: apiSnap,
          fileType: 'INVENTORY_HEALTH',
          productId: 'P1',
          optionId: 'O1',
          skuId: 'SKU-NEW',
          productName: 'x',
          availableStock: 100,
        },
      ],
    })
    try {
      const res = await getCoupangReturnStockByOption(SPACE_ID)
      // 재고는 최신(API) 스냅샷 기준
      expect(res!.snapshotDate.getTime()).toBe(apiSnap.getTime())
      // 등급은 CRAWL 스냅샷에서 와서 반품 판정이 유지된다
      expect(res!.byOption.get(optSingle)).toBe(7)
    } finally {
      await prisma.inventoryRecord.deleteMany({
        where: { workspaceId: WS_ID, snapshotDate: apiSnap },
      })
      await prisma.inventoryUpload.deleteMany({
        where: { workspaceId: WS_ID, snapshotDate: apiSnap },
      })
      uploadIdBySnap.delete(apiSnap.getTime())
    }
  })

  it('7) matrix row 에 위치별 반품량이 실리고 합계에는 포함된 채로 남는다', async () => {
    // 재고 현황 정책: 반품 **포함**. returnQtyByLocation 은 "그중 얼마"를 알리는 보조값.
    await prisma.invStockLevel.upsert({
      where: { optionId_locationId: { optionId: optSingle, locationId } },
      create: { spaceId: SPACE_ID, optionId: optSingle, locationId, quantity: 20 },
      update: { quantity: 20 },
    })
    const res = (await queryStockStatus(SPACE_ID, { includeReturnStock: true })) as {
      matrix: {
        rows: {
          optionId: string
          byLocation: Record<string, number>
          returnQtyByLocation?: Record<string, number>
        }[]
      }
    }
    const row = res.matrix.rows.find((r) => r.optionId === optSingle)
    expect(row).toBeDefined()
    // 합계는 원장 그대로 — 반품이 빠지지 않는다
    expect(row!.byLocation[locationId]).toBe(20)
    // 그중 반품 7
    expect(row!.returnQtyByLocation?.[locationId]).toBe(7)

    const clean = res.matrix.rows.find((r) => r.optionId === optSet)
    expect(clean?.returnQtyByLocation?.[locationId] ?? 0).toBe(6)
  })
})
