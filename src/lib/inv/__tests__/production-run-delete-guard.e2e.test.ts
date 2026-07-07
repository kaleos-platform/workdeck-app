/**
 * DELETE /production-runs/[runId] — STOCKED_IN 차수 삭제 차단 e2e.
 *
 * STOCKED_IN 차수는 삭제 불가: 입고 시 반영된 InvMovement/InvStockLevel 은 run 에
 * cascade 연결이 아니므로 run 만 삭제하면 재고가 부풀고 감사 추적이 끊긴다.
 * transition 역행 차단(감사 High #8/#9)과 동일 정책. throwaway space 에 시드 후 검증.
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
import { DELETE } from '../../../../app/api/sh/production-runs/[runId]/route'

const SPACE_ID = 'e2e00000-0000-4000-8000-00000000a1a1'
const USER_ID = 'e2e00000-0000-4000-8000-00000000a1a2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let stockedRunId = ''
let plannedRunId = ''
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

function deleteReq() {
  return new NextRequest('http://localhost/x', { method: 'DELETE' })
}

d('DELETE /production-runs/[runId] — STOCKED_IN 삭제 차단 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E DeleteGuard', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-delete-guard@throwaway.test' },
    })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 삭제가드상품', groupId: group.id, status: 'ACTIVE' },
    })
    optAId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } }))
      .id

    // STOCKED_IN 차수 — 삭제 차단 대상
    const stockedRun = await prisma.productionRun.create({
      data: {
        spaceId: SPACE_ID,
        runNo: 'E2E-DEL-STOCKED-001',
        status: 'STOCKED_IN',
        costMode: 'TOTAL',
        items: { create: [{ optionId: optAId, quantity: 50, stockedInQty: 50 }] },
      },
    })
    stockedRunId = stockedRun.id

    // PLANNED 차수 — 정상 삭제 대상
    const plannedRun = await prisma.productionRun.create({
      data: {
        spaceId: SPACE_ID,
        runNo: 'E2E-DEL-PLANNED-001',
        status: 'PLANNED',
        costMode: 'TOTAL',
        items: { create: [{ optionId: optAId, quantity: 20 }] },
      },
    })
    plannedRunId = plannedRun.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E DeleteGuard' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('STOCKED_IN 차수 DELETE → 409, run 이 DB 에 여전히 존재', async () => {
    const res = (await DELETE(deleteReq(), {
      params: Promise.resolve({ runId: stockedRunId }),
    }))!
    expect(res.status).toBe(409)

    // run 이 삭제되지 않았어야 함
    const run = await prisma.productionRun.findUnique({ where: { id: stockedRunId } })
    expect(run).not.toBeNull()
    expect(run?.status).toBe('STOCKED_IN')
  })

  test('PLANNED 차수 DELETE → 200, run 이 DB 에서 삭제됨', async () => {
    const res = (await DELETE(deleteReq(), {
      params: Promise.resolve({ runId: plannedRunId }),
    }))!
    expect(res.status).toBe(200)

    // run 이 정상 삭제되었어야 함
    const run = await prisma.productionRun.findUnique({ where: { id: plannedRunId } })
    expect(run).toBeNull()
  })
})
