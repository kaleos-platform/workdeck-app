/** @jest-environment node */
/**
 * applyBatchInbound + STOCKED_IN 전환 원자성 e2e.
 *
 * (1) ORDERED 차수 2-옵션 입고 → 200, run.status/StockLevel/InvMovement/stockedInQty 검증.
 * (2) applyBatchInbound 단독 호출 — 두 번째 item이 다른 스페이스 소속 옵션이면
 *     MovementError(reject) 후 첫 번째 옵션 StockLevel 이 롤백됨을 확인.
 * throwaway space, afterAll cascade 0-state 복원. DATABASE_URL/DIRECT_URL 없으면 skip.
 *
 * 실행: npx jest --config jest.config.e2e.ts src/lib/inv/__tests__/production-run-stockin-atomic.e2e.test.ts
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

import { resolveDeckContext } from '@/lib/api-helpers'
import { POST } from '../../../../app/api/sh/production-runs/[runId]/transition/route'
import { applyBatchInbound, MovementError } from '@/lib/inv/movement-processor'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000f2'
// 원자성 테스트용 두 번째 throwaway space (다른 스페이스 소속 옵션 시드)
const SPACE2_ID = 'e2e00000-0000-4000-8000-0000000000f3'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let runId = ''
let optAId = ''
let optBId = ''
let locationId = ''
// 원자성 테스트용 다른 스페이스 소속 옵션
let alienOptId = ''

async function cleanup() {
  // InvMovement/InvStockLevel 은 location/option cascade 로 삭제되나 명시 삭제로 순서 보장
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invMovement.deleteMany({ where: { spaceId: SPACE2_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE2_ID } })
  await prisma.productionRunItem.deleteMany({ where: { run: { spaceId: SPACE_ID } } })
  await prisma.productionRun.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE2_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE2_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE2_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE2_ID } })
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

d('STOCKED_IN 전환 원자성 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    // 기본 space + user + 상품 + 위치 시드
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E StockinAtomic', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-stockin-atomic@throwaway.test' } })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 원자상품', groupId: group.id, status: 'ACTIVE' },
    })
    optAId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } })).id
    optBId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'B' } })).id
    const loc = await prisma.invStorageLocation.create({
      data: { spaceId: SPACE_ID, name: 'E2E 창고', type: 'OWN' },
    })
    locationId = loc.id

    // 두 번째 space — 다른 스페이스 소속 옵션 (원자성 테스트용)
    await prisma.space.create({
      data: { id: SPACE2_ID, name: 'E2E StockinAtomic Space2', type: 'PERSONAL' },
    })
    const group2 = await prisma.invProductGroup.create({ data: { spaceId: SPACE2_ID, name: '기본' } })
    const product2 = await prisma.invProduct.create({
      data: { spaceId: SPACE2_ID, name: 'E2E 외부상품', groupId: group2.id, status: 'ACTIVE' },
    })
    alienOptId = (await prisma.invProductOption.create({ data: { productId: product2.id, name: 'X' } })).id

    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E StockinAtomic' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    // 각 테스트 전 차수 재생성 (runId 갱신)
    await prisma.productionRun.deleteMany({ where: { spaceId: SPACE_ID } })
    const run = await prisma.productionRun.create({
      data: {
        spaceId: SPACE_ID,
        runNo: 'E2E-ATOMIC-001',
        status: 'ORDERED',
        costMode: 'TOTAL',
        items: {
          create: [
            { optionId: optAId, quantity: 10 },
            { optionId: optBId, quantity: 5 },
          ],
        },
      },
    })
    runId = run.id
    // StockLevel 초기화
    await prisma.invStockLevel.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.invMovement.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  test('정상 전환: ORDERED → STOCKED_IN, StockLevel·InvMovement·stockedInQty 검증', async () => {
    const res = await POST(
      postReq({
        status: 'STOCKED_IN',
        transitionDate: '2026-07-07',
        allocations: [
          { optionId: optAId, locationId, quantity: 10 },
          { optionId: optBId, locationId, quantity: 5 },
        ],
      }),
      { params: Promise.resolve({ runId }) }
    )
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.run.status).toBe('STOCKED_IN')
    expect(body.movements).toHaveLength(2)

    // run 상태 확인
    const run = await prisma.productionRun.findUnique({ where: { id: runId } })
    expect(run?.status).toBe('STOCKED_IN')

    // StockLevel 확인
    const slA = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: optAId, locationId } },
    })
    expect(slA?.quantity).toBe(10)

    const slB = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: optBId, locationId } },
    })
    expect(slB?.quantity).toBe(5)

    // InvMovement INBOUND 2건, referenceId prodrun: 접두 확인
    const movements = await prisma.invMovement.findMany({
      where: { spaceId: SPACE_ID, type: 'INBOUND' },
    })
    expect(movements).toHaveLength(2)
    expect(movements.every((m) => m.referenceId?.startsWith('prodrun:'))).toBe(true)

    // stockedInQty 확인
    const items = await prisma.productionRunItem.findMany({ where: { runId } })
    const qtyA = items.find((it) => it.optionId === optAId)?.stockedInQty
    const qtyB = items.find((it) => it.optionId === optBId)?.stockedInQty
    expect(qtyA).toBe(10)
    expect(qtyB).toBe(5)
  })

  test('원자성: 두 번째 item이 다른 스페이스 소속 옵션이면 reject 후 롤백', async () => {
    // applyBatchInbound 직접 호출 — 두 번째 item 은 SPACE2 소속 alien 옵션
    await expect(
      prisma.$transaction(async (tx) =>
        applyBatchInbound(
          tx,
          SPACE_ID,
          [
            { optionId: optAId, locationId, quantity: 3 },
            { optionId: alienOptId, locationId, quantity: 2 },
          ],
          new Date('2026-07-07')
        )
      )
    ).rejects.toBeInstanceOf(MovementError)

    // 트랜잭션 롤백 — 유효 옵션(optAId) StockLevel 이 생성되지 않았거나 수량 불변
    const sl = await prisma.invStockLevel.findUnique({
      where: { optionId_locationId: { optionId: optAId, locationId } },
    })
    // 롤백됐으면 row 없음(이전 beforeEach 에서 삭제함), 있더라도 quantity가 0이어야 함
    expect(sl === null || sl.quantity === 0).toBe(true)
  })
})
