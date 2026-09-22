/**
 * 발주 계획에서 반품 등급 재고 차감 e2e.
 *
 * 쿠팡이 고객 반품품을 별도 상품으로 재등록한 재고는 반품 전용 리스팅에서만 팔려
 * 정상 상품 수요를 메우지 못한다. 재고 현황에는 실물이므로 포함하되, 발주 계산에서는
 * 가용재고로 세지 않는다(세면 발주가 과소 산출된다).
 *
 * 검증:
 *   1. onHandStock 에서 반품량이 빠지고 응답에 returnQty 가 실린다
 *   2. 반품이 없는 옵션은 영향 없음(returnQty 미노출)
 *   3. 반품량 > 현재고여도 음수 재고를 만들지 않는다
 *
 * 실제 라우트 핸들러 호출. auth/LLM mock. afterAll cascade 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})
jest.mock('@/lib/ai/resolve', () => ({
  __esModule: true,
  generateTextForSpace: jest.fn(async () => ({
    result: { content: 'e2e rationale', latencyMs: 1 },
    providerName: 'mock',
    mode: 'WORKDECK',
  })),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { POST } from '../../../../app/api/sh/inventory/reorder/plan/route'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '../external-sources'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const WS_ID = 'e2e00000-0000-4000-8000-0000000000f3'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const SNAP = new Date('2026-07-10T00:00:00.000Z')

let productId = ''
let optReturn = '' // 반품 재고가 있는 옵션
let optClean = '' // 반품 없는 옵션
let optOver = '' // 반품량 > 현재고
let locationId = ''

async function cleanup() {
  await prisma.reorderPlanItem.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlanSet.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invLocationProductMapItem.deleteMany({ where: { map: { spaceId: SPACE_ID } } })
  await prisma.invLocationProductMap.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.workspace.deleteMany({ where: { id: WS_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sh/inventory/reorder/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

d('POST /reorder/plan — 반품 등급 재고 차감 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E ReturnDeduct', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-returndeduct@throwaway.test' } })
    await prisma.workspace.create({ data: { id: WS_ID, ownerId: USER_ID, name: 'E2E RD WS' } })

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
      data: { spaceId: SPACE_ID, name: 'E2E 발주상품', groupId: group.id, status: 'ACTIVE' },
    })
    productId = product.id
    optReturn = (
      await prisma.invProductOption.create({
        data: { productId, name: '반품있음', safetyStockQty: 0 },
      })
    ).id
    optClean = (
      await prisma.invProductOption.create({
        data: { productId, name: '반품없음', safetyStockQty: 0 },
      })
    ).id
    optOver = (
      await prisma.invProductOption.create({
        data: { productId, name: '반품초과', safetyStockQty: 0 },
      })
    ).id

    // 현재고: 반품있음 10, 반품없음 10, 반품초과 3
    for (const [optionId, quantity] of [
      [optReturn, 10],
      [optClean, 10],
      [optOver, 3],
    ] as const) {
      await prisma.invStockLevel.create({
        data: { spaceId: SPACE_ID, optionId, locationId, quantity },
      })
    }

    const upload = await prisma.inventoryUpload.create({
      data: {
        workspaceId: WS_ID,
        fileName: 'e2e-rd.xlsx',
        fileType: 'INVENTORY_HEALTH',
        snapshotDate: SNAP,
        totalRows: 3,
        insertedRows: 3,
        source: 'CRAWL',
      },
    })
    const rec = (
      productId2: string,
      optionId2: string,
      sku: string,
      grade: string,
      stock: number
    ) =>
      prisma.inventoryRecord.create({
        data: {
          workspaceId: WS_ID,
          uploadId: upload.id,
          snapshotDate: SNAP,
          fileType: 'INVENTORY_HEALTH',
          productId: productId2,
          optionId: optionId2,
          skuId: sku,
          productName: 'E2E 발주상품',
          productGrade: grade,
          availableStock: stock,
        },
      })
    await rec('P-N', 'O-N', 'SKU-NEW', 'NEW', 6)
    await rec('P-R', 'O-R', 'SKU-RET', '반품-최상', 4)
    await rec('P-O', 'O-O', 'SKU-OVER', '반품-상', 9)

    const addMap = async (code: string, optionId: string) => {
      const m = await prisma.invLocationProductMap.create({
        data: { spaceId: SPACE_ID, locationId, externalCode: code, externalName: code },
      })
      await prisma.invLocationProductMapItem.create({
        data: { mapId: m.id, optionId, quantity: 1 },
      })
    }
    await addMap('SKU-NEW', optReturn) // 정상분 — 차감 대상 아님
    await addMap('SKU-RET', optReturn) // 반품 4
    await addMap('SKU-OVER', optOver) // 반품 9 > 현재고 3
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E ReturnDeduct' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('반품량만큼 onHandStock 이 줄고 returnQty 가 응답에 실린다', async () => {
    const res = (await POST(post({ productId, dryRun: true })))!
    expect(res.status).toBe(200)
    const json = await res.json()
    type OptRow = { optionId: string; onHandStock: number; returnQty?: number }
    const byOpt = new Map<string, OptRow>((json.options as OptRow[]).map((o) => [o.optionId, o]))

    // 1) 반품 4 차감 → 10 - 4 = 6
    const ret = byOpt.get(optReturn)!
    expect(ret.onHandStock).toBe(6)
    expect(ret.returnQty).toBe(4)

    // 2) 반품 없는 옵션은 그대로
    const clean = byOpt.get(optClean)!
    expect(clean.onHandStock).toBe(10)
    expect(clean.returnQty).toBeUndefined()

    // 3) 반품 9 > 현재고 3 → 음수 아닌 0
    const over = byOpt.get(optOver)!
    expect(over.onHandStock).toBe(0)
    expect(over.returnQty).toBe(9)
  })
})
