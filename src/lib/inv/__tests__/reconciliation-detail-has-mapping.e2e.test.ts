/**
 * GET /api/sh/inventory/reconciliation/[id] — system-only 엔트리의 hasMapping 첨부 e2e.
 *
 * UI(reconciliation-preview)가 '매핑 필요' 배지·안내 배너·'쿠팡 SKU 연결' 버튼을 띄우는 근거가
 * 이 필드다. 잘못 내려가면 매핑이 있는데 연결을 요구하거나(오안내), 매핑이 없는데 아무 안내도
 * 안 나와 재고가 영영 자동 대조에서 빠진다.
 *
 * 라우트 핸들러를 직접 호출하고 resolveDeckContext 만 mock 해 인증을 우회한다
 * (inv-coupang-sync.e2e.test.ts 와 동일 패턴).
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveDeckContext: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { GET } from '@/app/api/sh/inventory/reconciliation/[id]/route'
import { processMovement } from '../movement-processor'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000d2'
const SNAPSHOT = new Date('2026-04-01T03:30:00.000Z')

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let locationId = ''
let mappedOptionId = ''
let orphanOptionId = ''
let reconId = ''

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

type SystemOnlyEntry = {
  status: string
  optionId: string
  optionName: string
  hasMapping?: boolean
}

d('GET reconciliation/[id] — system-only hasMapping (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E HasMapping', type: 'PERSONAL' } })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-has-mapping@throwaway.test' } })

    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 로켓그로스', type: 'THIRD_PARTY', isActive: true },
    })
    locationId = loc.id

    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 상품', groupId: group.id, status: 'ACTIVE' },
    })
    const mapped = await prisma.invProductOption.create({
      data: { productId: product.id, name: '매핑된옵션' },
    })
    const orphan = await prisma.invProductOption.create({
      data: { productId: product.id, name: '미연동옵션' },
    })
    mappedOptionId = mapped.id
    orphanOptionId = orphan.id

    const map = await prisma.invLocationProductMap.create({
      data: { spaceId: SPACE_ID, locationId, externalCode: 'E2E-HM-1' },
    })
    await prisma.invLocationProductMapItem.create({
      data: { mapId: map.id, optionId: mappedOptionId, quantity: 1 },
    })

    for (const optionId of [mappedOptionId, orphanOptionId]) {
      await processMovement(SPACE_ID, {
        type: 'INBOUND',
        optionId,
        locationId,
        quantity: 5,
        movementDate: new Date('2026-03-20').toISOString(),
        reason: 'E2E 시드 입고',
      })
    }

    const recon = await prisma.invReconciliation.create({
      data: {
        spaceId: SPACE_ID,
        locationId,
        fileName: 'e2e-has-mapping.xlsx',
        snapshotDate: SNAPSHOT,
        status: 'PARTIAL',
        matchResults: [
          {
            status: 'system-only',
            optionId: mappedOptionId,
            locationId,
            productName: 'E2E 상품',
            optionName: '매핑된옵션',
            systemQuantity: 5,
          },
          {
            status: 'system-only',
            optionId: orphanOptionId,
            locationId,
            productName: 'E2E 상품',
            optionName: '미연동옵션',
            systemQuantity: 5,
          },
        ],
        totalItems: 2,
        matchedItems: 0,
      },
    })
    reconId = recon.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      user: { id: USER_ID },
      space: { id: SPACE_ID, name: 'E2E HasMapping' },
      role: 'OWNER',
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('매핑 유무가 hasMapping 으로 정확히 내려온다', async () => {
    const res = await GET(
      new NextRequest(`http://localhost/api/sh/inventory/reconciliation/${reconId}`),
      { params: Promise.resolve({ id: reconId }) }
    )
    if (!res) throw new Error('라우트가 응답을 반환하지 않았습니다')
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      reconciliation: { matchResults: SystemOnlyEntry[] }
    }
    const entries = body.reconciliation.matchResults.filter((e) => e.status === 'system-only')
    expect(entries).toHaveLength(2)

    const mappedEntry = entries.find((e) => e.optionId === mappedOptionId)
    const orphanEntry = entries.find((e) => e.optionId === orphanOptionId)

    // 매핑 있음 → UI 는 회색 '파일 누락' 배지만, 연결 버튼 없음
    expect(mappedEntry?.hasMapping).toBe(true)
    // 매핑 없음 → UI 는 '매핑 필요' 배지 + '쿠팡 SKU 연결' 버튼 + 안내 배너
    expect(orphanEntry?.hasMapping).toBe(false)
  })
})
