/**
 * 생산 차수 STOCKED_IN 직접 지정 차단 e2e (라우트 핸들러 직접 호출).
 *
 * 배경: 차수 폼의 상태 Select 로 "입고완료"를 저장하면 POST/PATCH 가 상태만 바꾸고
 * 재고 INBOUND 를 만들지 않는다. 운영에서 2026-07 이후 차수 9건(14,910개)이 이 경로로
 * 재고 없이 STOCKED_IN 이 됐다. 입고는 /transition(위치·수량 분배)만 통과해야 한다.
 *
 * 검증:
 *   1. POST 로 status=STOCKED_IN 생성 → 400, 차수 미생성.
 *   2. PATCH 로 ORDERED → STOCKED_IN 전환 → 400, 상태 불변.
 *   3. 이미 STOCKED_IN 인 차수에 같은 status 를 다시 보내는 수정은 통과(400 아님).
 *
 * throwaway Space/User, afterAll cascade 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let optionId = ''
let orderedRunId = ''
let stockedInRunId = ''

// resolveDeckContext(세션·DeckInstance)를 우회해 라우트 로직만 검증한다.
jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return {
    ...actual,
    resolveDeckContext: jest.fn(async () => ({
      user: { id: 'e2e00000-0000-4000-8000-0000000000c2' },
      space: { id: 'e2e00000-0000-4000-8000-0000000000c1', name: 'E2E StockInGuard' },
      role: 'OWNER',
    })),
  }
})

async function cleanup() {
  await prisma.productionRunItem.deleteMany({ where: { run: { spaceId: SPACE_ID } } })
  await prisma.productionRunCost.deleteMany({ where: { run: { spaceId: SPACE_ID } } })
  await prisma.productionRun.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/sh/production-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

d('생산 차수 STOCKED_IN 직접 지정 차단 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()

    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E StockInGuard', type: 'PERSONAL' },
    })
    await prisma.user.create({
      data: { id: USER_ID, email: 'e2e-stockin-guard@throwaway.test' },
    })
    const group = await prisma.invProductGroup.create({
      data: { spaceId: SPACE_ID, name: '기본' },
    })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 생산상품', groupId: group.id, status: 'ACTIVE' },
    })
    const option = await prisma.invProductOption.create({
      data: { productId: product.id, name: '기본' },
    })
    optionId = option.id

    const ordered = await prisma.productionRun.create({
      data: { spaceId: SPACE_ID, runNo: 'E2E-ORD', status: 'ORDERED' },
    })
    orderedRunId = ordered.id

    const stockedIn = await prisma.productionRun.create({
      data: { spaceId: SPACE_ID, runNo: 'E2E-STK', status: 'STOCKED_IN' },
    })
    stockedInRunId = stockedIn.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  it('POST 로 status=STOCKED_IN 생성은 400 이고 차수가 만들어지지 않는다', async () => {
    const { POST } = await import('@/app/api/sh/production-runs/route')

    const res = await POST(
      jsonRequest({
        runNo: 'E2E-NEW',
        status: 'STOCKED_IN',
        costMode: 'TOTAL',
        items: [{ optionId, quantity: 100 }],
      })
    )

    expect(res?.status).toBe(400)
    const created = await prisma.productionRun.findFirst({
      where: { spaceId: SPACE_ID, runNo: 'E2E-NEW' },
    })
    expect(created).toBeNull()
  })

  it('PATCH 로 ORDERED → STOCKED_IN 전환은 400 이고 상태가 그대로다', async () => {
    const { PATCH } = await import('@/app/api/sh/production-runs/[runId]/route')

    const res = await PATCH(jsonRequest({ status: 'STOCKED_IN' }), {
      params: Promise.resolve({ runId: orderedRunId }),
    })

    expect(res?.status).toBe(400)
    const after = await prisma.productionRun.findUnique({ where: { id: orderedRunId } })
    expect(after?.status).toBe('ORDERED')
  })

  it('이미 STOCKED_IN 인 차수의 다른 필드 수정은 막지 않는다', async () => {
    const { PATCH } = await import('@/app/api/sh/production-runs/[runId]/route')

    const res = await PATCH(jsonRequest({ status: 'STOCKED_IN', memo: 'E2E 메모' }), {
      params: Promise.resolve({ runId: stockedInRunId }),
    })

    expect(res?.status).not.toBe(400)
    const after = await prisma.productionRun.findUnique({ where: { id: stockedInRunId } })
    expect(after?.status).toBe('STOCKED_IN')
    expect(after?.memo).toBe('E2E 메모')
  })
})
