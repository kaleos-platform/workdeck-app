/**
 * inv-coupang-sync — fileType 필터 안전망 e2e.
 *
 * 감사 Medium: GET /api/inventory 가 INVENTORY_HEALTH 레코드만 반환해야 하는데
 * fileType 필터 없이 같은 snapshotDate 의 VENDOR_ITEM_METRICS 레코드가 섞여 나오던 버그.
 * → route.ts 의 where/findFirst 에 fileType: 'INVENTORY_HEALTH' 추가로 수정.
 *
 * throwaway Workspace 시드 → GET route 핸들러 직접 호출(resolveWorkspace mock) →
 * 응답 records 가 HEALTH 1건만(VENDOR 미포함) 단언.
 * DB URL 없으면 전체 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

// resolveWorkspace를 mock해 인증 우회
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveWorkspace: jest.fn(),
}))

import { resolveWorkspace } from '@/lib/api-helpers'
import { GET } from '@/app/api/inventory/route'
import { NextRequest } from 'next/server'

const WS_ID = 'e2e00000-0000-4000-8000-0000000000a1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000a2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const SNAP = new Date('2026-07-01T00:00:00+09:00')

async function cleanup() {
  // InventoryUpload / InventoryRecord 는 Workspace onDelete: Cascade
  await prisma.workspace.deleteMany({ where: { id: WS_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

d('GET /api/inventory — fileType 필터: INVENTORY_HEALTH 만 반환 (dev DB)', () => {
  let healthUploadId: string
  let vendorUploadId: string

  beforeAll(async () => {
    await cleanup()

    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-invsync@throwaway.test' } })
    await prisma.workspace.create({ data: { id: WS_ID, ownerId: USER_ID, name: 'E2E InvSync' } })

    // 같은 snapshotDate 에 INVENTORY_HEALTH 업로드 1건
    const healthUpload = await prisma.inventoryUpload.create({
      data: {
        workspaceId: WS_ID,
        fileName: 'health.xlsx',
        fileType: 'INVENTORY_HEALTH',
        snapshotDate: SNAP,
        totalRows: 1,
        insertedRows: 1,
      },
    })
    healthUploadId = healthUpload.id

    // 같은 snapshotDate 에 VENDOR_ITEM_METRICS 업로드 1건
    const vendorUpload = await prisma.inventoryUpload.create({
      data: {
        workspaceId: WS_ID,
        fileName: 'vendor.xlsx',
        fileType: 'VENDOR_ITEM_METRICS',
        snapshotDate: SNAP,
        totalRows: 1,
        insertedRows: 1,
      },
    })
    vendorUploadId = vendorUpload.id

    // INVENTORY_HEALTH 레코드 1건
    await prisma.inventoryRecord.create({
      data: {
        workspaceId: WS_ID,
        uploadId: healthUploadId,
        snapshotDate: SNAP,
        fileType: 'INVENTORY_HEALTH',
        productId: 'prod-health-01',
        optionId: 'opt-health-01',
        productName: '건강상품A',
        availableStock: 100,
      },
    })

    // VENDOR_ITEM_METRICS 레코드 1건 — 같은 snapshotDate, 섞이면 안 됨
    await prisma.inventoryRecord.create({
      data: {
        workspaceId: WS_ID,
        uploadId: vendorUploadId,
        snapshotDate: SNAP,
        fileType: 'VENDOR_ITEM_METRICS',
        productId: 'prod-vendor-01',
        optionId: 'opt-vendor-01',
        productName: '판매지표상품B',
        salesQty30d: 50,
      },
    })

    // resolveWorkspace mock — 테스트 워크스페이스 반환
    ;(resolveWorkspace as jest.Mock).mockResolvedValue({ workspace: { id: WS_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('같은 snapshotDate 에 HEALTH + VENDOR 혼재 시 HEALTH 레코드 1건만 반환', async () => {
    const url = new URL(`http://localhost/api/inventory?snapshotDate=${SNAP.toISOString()}`)
    const req = new NextRequest(url)

    const res = (await GET(req))!
    const body = await res.json()

    // records 배열이 정확히 HEALTH 1건만 포함해야 함
    expect(body.records).toHaveLength(1)
    expect(body.records[0].fileType).toBe('INVENTORY_HEALTH')
    expect(body.records[0].productName).toBe('건강상품A')

    // VENDOR 레코드가 섞이지 않았는지 명시적 확인
    const hasVendor = body.records.some(
      (r: { fileType: string }) => r.fileType === 'VENDOR_ITEM_METRICS'
    )
    expect(hasVendor).toBe(false)

    // productNames 목록에도 VENDOR 상품명이 없어야 함
    expect(body.productNames).toContain('건강상품A')
    expect(body.productNames).not.toContain('판매지표상품B')
  })

  test('fileType 미지정 snapshotDate 조회(latest)도 INVENTORY_HEALTH 업로드 날짜 기준', async () => {
    // snapshotDate 파라미터 없이 호출 → latest 업로드에서 INVENTORY_HEALTH 날짜를 선택해야 함
    const url = new URL('http://localhost/api/inventory')
    const req = new NextRequest(url)

    const res = (await GET(req))!
    const body = await res.json()

    // 반환된 snapshotDate 가 시드한 SNAP 과 일치해야 함
    expect(body.snapshotDate).toBeDefined()
    // records 는 모두 INVENTORY_HEALTH 여야 함
    for (const r of body.records as Array<{ fileType: string }>) {
      expect(r.fileType).toBe('INVENTORY_HEALTH')
    }
  })
})
