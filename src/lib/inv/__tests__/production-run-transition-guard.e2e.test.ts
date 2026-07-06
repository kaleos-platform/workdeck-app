/**
 * POST /production-runs/[runId]/transition — 입고완료(STOCKED_IN) 역행 전환 차단 e2e.
 *
 * STOCKED_IN 은 종료 상태. ORDERED/PLANNED 로 되돌리면 이미 반영된 INBOUND 재고가 역산되지
 * 않고 재전환 시 이중 입고가 발생하므로 서버가 409 로 차단해야 한다(감사 High #8/#9).
 * throwaway space 에 STOCKED_IN 차수를 직접 시드. auth 는 resolveDeckContext mock.
 * afterAll cascade 로 0-state 복원. DB URL 없으면 skip.
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

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000e2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let runId = ''
let optAId = ''

async function cleanup() {
  await prisma.productionRunItem.deleteMany({ where: { run: { spaceId: SPACE_ID } } })
  await prisma.productionRun.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

d('POST /production-runs/[runId]/transition — STOCKED_IN 역행 차단 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E TransitionGuard', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-transition-guard@throwaway.test' } })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 역행상품', groupId: group.id, status: 'ACTIVE' },
    })
    optAId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } })).id
    const run = await prisma.productionRun.create({
      data: {
        spaceId: SPACE_ID,
        runNo: 'E2E-TRANS-001',
        status: 'STOCKED_IN',
        costMode: 'TOTAL',
        items: { create: [{ optionId: optAId, quantity: 100, stockedInQty: 100 }] },
      },
    })
    runId = run.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E TransitionGuard' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('STOCKED_IN → ORDERED 되돌리기는 409, 상태·입고량 불변', async () => {
    const res = await POST(postReq({ status: 'ORDERED', transitionDate: '2026-07-06' }), {
      params: Promise.resolve({ runId }),
    })
    expect(res.status).toBe(409)

    const run = await prisma.productionRun.findUnique({ where: { id: runId } })
    expect(run?.status).toBe('STOCKED_IN')
    const item = await prisma.productionRunItem.findFirst({ where: { runId } })
    expect(item?.stockedInQty).toBe(100)
  })

  test('STOCKED_IN → PLANNED 되돌리기는 409, 입고량 clear 안 됨', async () => {
    const res = await POST(postReq({ status: 'PLANNED', transitionDate: '2026-07-06' }), {
      params: Promise.resolve({ runId }),
    })
    expect(res.status).toBe(409)

    const item = await prisma.productionRunItem.findFirst({ where: { runId } })
    expect(item?.stockedInQty).toBe(100)
  })
})
