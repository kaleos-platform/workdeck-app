/**
 * PATCH /production-runs/[runId] — 발주 수량 수정 시 실제 입고 수량(stockedInQty) 보존 e2e.
 *
 * 입고완료(STOCKED_IN) 차수에서 옵션 발주 수량만 바꿔 PATCH 하면 stockedInQty 가 유지되어야 한다
 * (발주와 입고의 차이를 관리하기 위함). throwaway space 에 차수·옵션을 직접 시드.
 * auth 는 resolveDeckContext mock. afterAll cascade 로 0-state 복원. DB URL 없으면 skip.
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
import { PATCH } from '../../../../app/api/sh/production-runs/[runId]/route'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000d2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let runId = ''
let optAId = ''
let optBId = ''
let optCId = ''

async function cleanup() {
  await prisma.productionRunItem.deleteMany({ where: { run: { spaceId: SPACE_ID } } })
  await prisma.productionRun.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

d('PATCH /production-runs/[runId] — 발주 수정 시 입고 수량 보존 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E PatchStockedIn', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-patch-stockedin@throwaway.test' } })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 입고상품', groupId: group.id, status: 'ACTIVE' },
    })
    optAId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } }))
      .id
    optBId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'B' } }))
      .id
    optCId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'C' } }))
      .id
    // 입고완료 차수 — 옵션별 발주/실입고 세팅 (A: 발주100/입고98, B: 발주200/입고200)
    const run = await prisma.productionRun.create({
      data: {
        spaceId: SPACE_ID,
        runNo: 'E2E-PATCH-001',
        status: 'STOCKED_IN',
        costMode: 'TOTAL',
        items: {
          create: [
            { optionId: optAId, quantity: 100, stockedInQty: 98 },
            { optionId: optBId, quantity: 200, stockedInQty: 200 },
          ],
        },
      },
    })
    runId = run.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E PatchStockedIn' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('발주 수량만 변경해도 stockedInQty 유지 (신규 옵션은 null)', async () => {
    // A 발주 100→120, B 유지 200, C 신규 추가(50). (입고는 payload에 없음 — 서버가 기존값 보존)
    const res = await PATCH(
      patchReq({
        runNo: 'E2E-PATCH-001',
        costMode: 'TOTAL',
        items: [
          { optionId: optAId, quantity: 120 },
          { optionId: optBId, quantity: 200 },
          { optionId: optCId, quantity: 50 },
        ],
      }),
      { params: Promise.resolve({ runId }) }
    )
    if (!res) throw new Error('응답 없음')
    expect(res.status).toBe(200)

    const items = await prisma.productionRunItem.findMany({
      where: { runId },
      select: { optionId: true, quantity: true, stockedInQty: true },
    })
    const byOpt = new Map(items.map((i) => [i.optionId, i]))
    // 발주는 갱신, 입고는 보존
    expect(byOpt.get(optAId)).toMatchObject({ quantity: 120, stockedInQty: 98 })
    expect(byOpt.get(optBId)).toMatchObject({ quantity: 200, stockedInQty: 200 })
    // 신규 옵션은 stockedInQty null (아직 미입고)
    expect(byOpt.get(optCId)).toMatchObject({ quantity: 50, stockedInQty: null })
  })
})
