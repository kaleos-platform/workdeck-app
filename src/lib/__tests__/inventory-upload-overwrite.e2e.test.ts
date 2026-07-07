/**
 * processInventoryUpload — 스냅샷 재업로드(덮어쓰기) 원자성 e2e.
 *
 * 같은 (workspace, snapshotDate, fileType) 재업로드 시 기존 레코드가 단일 트랜잭션 안에서
 * 삭제→재삽입되어 정확히 교체되어야 한다(중복 누적·유실 없음, 감사 High #6).
 * parseInventoryExcel 은 mock, DB 는 실제 dev DB. throwaway workspace 사용, DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

jest.mock('@/lib/inventory-parser', () => ({
  __esModule: true,
  parseInventoryExcel: jest.fn(),
}))

import { parseInventoryExcel } from '@/lib/inventory-parser'
import { processInventoryUpload } from '@/lib/inventory-upload-processor'

const WS_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const SNAP = new Date('2026-07-06T00:00:00+09:00')

function mockRows(rows: Array<{ productId: string; optionId: string; productName: string }>) {
  ;(parseInventoryExcel as jest.Mock).mockReturnValue({ fileType: 'VENDOR_ITEM_METRICS', rows })
}

function uploadArgs(fileName: string) {
  return { workspaceId: WS_ID, fileName, buffer: new ArrayBuffer(1), snapshotDate: SNAP }
}

async function cleanup() {
  // InventoryUpload/Record 는 Workspace onDelete: Cascade
  await prisma.workspace.deleteMany({ where: { id: WS_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

d('processInventoryUpload — 재업로드 덮어쓰기 원자성 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-invupload@throwaway.test' } })
    await prisma.workspace.create({ data: { id: WS_ID, ownerId: USER_ID, name: 'E2E InvUpload' } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('같은 스냅샷 재업로드 시 기존 레코드가 정확히 교체됨(중복 누적 없음)', async () => {
    mockRows([
      { productId: 'prod-1', optionId: 'opt-1', productName: 'P1' },
      { productId: 'prod-2', optionId: 'opt-2', productName: 'P2' },
    ])
    const r1 = await processInventoryUpload(uploadArgs('a.xlsx'))
    expect(r1.success).toBe(true)
    if (r1.success) expect(r1.insertedRows).toBe(2)

    // 재업로드 — 1행으로 축소
    mockRows([{ productId: 'prod-1', optionId: 'opt-1', productName: 'P1-updated' }])
    const r2 = await processInventoryUpload(uploadArgs('b.xlsx'))
    expect(r2.success).toBe(true)

    // 정확히 교체: InventoryUpload 1건, InventoryRecord 1건(P1-updated)
    const uploads = await prisma.inventoryUpload.findMany({
      where: { workspaceId: WS_ID, snapshotDate: SNAP, fileType: 'VENDOR_ITEM_METRICS' },
    })
    expect(uploads).toHaveLength(1)

    const records = await prisma.inventoryRecord.findMany({ where: { workspaceId: WS_ID } })
    expect(records).toHaveLength(1)
    expect(records[0].productName).toBe('P1-updated')
  })
})
