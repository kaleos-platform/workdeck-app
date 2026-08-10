/**
 * 자동 재고 대조 cron — 멱등 skip-marker e2e.
 *
 * 핵심 검증(재고 무음 손상 방지):
 *   1. 1회차: 스냅샷 기준 ADJUSTMENT 반영 (재고 100).
 *   2. 중간 INBOUND +50 → 150.
 *   3. 2회차(같은 스냅샷): skip:already-applied — 새 대조 레코드를 만들지 않고 재고 150 보존.
 *      → skip-marker 없으면 새 reconciliationId 로 confirm 되고 referenceId 가 달라져
 *        preApplied 가드(reconciliation-processor.ts)가 빈 set 을 보게 되어 100 으로 clobber.
 *
 * throwaway Space/User/Workspace, afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

// Slack 발송 차단 (네트워크·토큰 불필요)
jest.mock('@/lib/slack-inventory-notifier', () => ({
  notifyAutoReconciliation: jest.fn().mockResolvedValue(false),
}))

import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/coupang-inventory-sync/route'
import { processMovement } from '../movement-processor'


const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'
const WS_ID = 'e2e00000-0000-4000-8000-0000000000c3'
const WORKER_KEY = 'e2e-worker-key-auto-recon'
const EXTERNAL_CODE = 'E2E-SKU-CRON-1'
const SNAPSHOT = new Date('2026-03-01T03:30:00.000Z')

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let optionId = ''

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
  await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID } })
  // InventoryUpload/Record 는 Workspace cascade, Workspace 는 User cascade
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function cronRequest() {
  return new NextRequest('http://localhost/api/cron/coupang-inventory-sync', {
    headers: { 'x-worker-api-key': WORKER_KEY },
  })
}

async function runCron(): Promise<{
  spaces: Array<{ spaceId: string; status: string; adjusted?: number; zeroed?: number }>
}> {
  const res = await GET(cronRequest())
  if (!res) throw new Error('cron 라우트가 응답을 반환하지 않았습니다')
  return res.json()
}

function findSpace(body: Awaited<ReturnType<typeof runCron>>) {
  return body.spaces.find((s) => s.spaceId === SPACE_ID)
}

d('자동 재고 대조 cron 멱등성 (dev DB)', () => {
  beforeAll(async () => {
    process.env.WORKER_API_KEY = WORKER_KEY
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E AutoRecon', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-auto-recon@throwaway.test' },
    })
    await prisma.workspace.create({
      data: { id: WS_ID, ownerId: USER_ID, name: 'E2E AutoRecon WS' },
    })

    // 쿠팡 Deck 활성화 (DeckApp 은 공용 시드 — 없으면 생성)
    await prisma.deckApp.upsert({
      where: { id: 'coupang-ads' },
      create: { id: 'coupang-ads', name: '쿠팡 광고 관리' },
      update: {},
    })
    await prisma.deckInstance.create({
      data: { spaceId: SPACE_ID, deckAppId: 'coupang-ads', isActive: true },
    })

    // 로켓그로스 위치 — externalIntegrationKey 로 Workspace 결정적 해석
    const loc = await prisma.invStorageLocation.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 로켓그로스',
        type: 'THIRD_PARTY',
        isActive: true,
        externalSource: 'coupang_rocket_growth',
        externalIntegrationKey: WS_ID,
      },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 자동대조상품', groupId: group.id, status: 'ACTIVE' },
    })
    const option = await prisma.invProductOption.create({
      data: { productId: product.id, name: '기본옵션' },
    })
    optionId = option.id

    // externalCode 매핑 — locationMappings some:{} 필터도 이 행으로 통과한다
    const map = await prisma.invLocationProductMap.create({
      data: { spaceId: SPACE_ID, locationId, externalCode: EXTERNAL_CODE },
    })
    await prisma.invLocationProductMapItem.create({
      data: { mapId: map.id, optionId, quantity: 1 },
    })

    // 스냅샷 — 판매가능재고 100
    const upload = await prisma.inventoryUpload.create({
      data: {
        workspaceId: WS_ID,
        fileName: 'health.xlsx',
        fileType: 'INVENTORY_HEALTH',
        snapshotDate: SNAPSHOT,
        totalRows: 1,
        insertedRows: 1,
      },
    })
    await prisma.inventoryRecord.create({
      data: {
        workspaceId: WS_ID,
        uploadId: upload.id,
        snapshotDate: SNAPSHOT,
        fileType: 'INVENTORY_HEALTH',
        productId: 'P1',
        optionId: 'O1',
        skuId: EXTERNAL_CODE,
        productName: 'E2E 자동대조상품',
        optionName: '기본옵션',
        availableStock: 100,
      },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('1회차: 스냅샷 반영 — 재고 100', async () => {
    const body = await runCron()
    const mine = findSpace(body)

    expect(mine?.status).toBe('ok')
    expect(mine?.adjusted).toBe(1)

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
      movementDate: new Date('2026-03-02').toISOString(),
      reason: 'FC 입고 (cron 멱등성 테스트)',
    })

    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(150)
  })

  test('2회차 같은 스냅샷: skip:already-applied + 재고 150 보존 — 핵심 assertion', async () => {
    const body = await runCron()
    const mine = findSpace(body)

    expect(mine?.status).toBe('skip:already-applied')

    // 대조 레코드가 늘지 않아야 한다 (새 referenceId 생성 = clobber 경로)
    const recons = await prisma.invReconciliation.count({ where: { spaceId: SPACE_ID } })
    expect(recons).toBe(1)

    // 중간 INBOUND 보존 — 스냅샷 100 으로 덮이지 않음
    const stock = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId, locationId } },
    })
    expect(stock?.quantity).toBe(150)
  })
})
