/**
 * 발주 생성 위저드 백엔드 e2e — POST /reorder/plan 신규 경로(dryRun · optionFinalOverrides) 런타임 검증.
 *
 * 정적 검사(lint/tsc/build)로는 못 잡는 경로: dryRun 응답 조립 + 5.6 override merge → persist.
 * 전용 throwaway space에 평이 상품(로켓 세트 없음)을 시드하고 실제 라우트 핸들러를 호출한다.
 * auth 는 resolveDeckContext mock, LLM 은 provider mock 으로 우회. afterAll cascade 로 0-state 복원.
 * DATABASE_URL/DIRECT_URL 없으면 describe.skip. ([[reference_prisma7_jest_integration]])
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

// auth mock — errorResponse 등 실제 export 는 보존, resolveDeckContext 만 대체.
jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})
// LLM 우회 — 네트워크 없이 결정론적 rationale.
jest.mock('@/lib/ai/providers', () => ({
  __esModule: true,
  generateTextWithFallback: jest.fn(async () => 'e2e rationale'),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { POST } from '../../../../app/api/sh/inventory/reorder/plan/route'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000b7'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000b8'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let productId = ''
let optAId = ''
let optBId = ''

async function cleanup() {
  await prisma.reorderPlanItem.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlanSet.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
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

d('POST /reorder/plan — dryRun · optionFinalOverrides (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E Wizard Throwaway', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-wizard@throwaway.test' } })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 평이상품', groupId: group.id, status: 'ACTIVE' },
    })
    productId = product.id
    const a = await prisma.invProductOption.create({
      data: { productId, name: '옵션A', safetyStockQty: 0 },
    })
    const b = await prisma.invProductOption.create({
      data: { productId, name: '옵션B', safetyStockQty: 0 },
    })
    optAId = a.id
    optBId = b.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E Wizard Throwaway' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('dryRun — persist 없이 옵션 계산 결과 반환(평이 상품 qualifies=false)', async () => {
    const before = await prisma.reorderPlan.count({ where: { spaceId: SPACE_ID } })
    const res = await POST(post({ productId, dryRun: true }))
    if (!res) throw new Error('응답 없음')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.dryRun).toBe(true)
    expect(json.qualifies).toBe(false) // 로켓 세트 없음
    expect(json.isLayered).toBe(false)
    expect(json.options).toHaveLength(2)
    const ids = json.options.map((o: { optionId: string }) => o.optionId).sort()
    expect(ids).toEqual([optAId, optBId].sort())
    for (const o of json.options) {
      expect(typeof o.optionName).toBe('string')
      expect(typeof o.finalQty).toBe('number')
      expect(o.rocketBaselineQty).toBeNull() // 비레이어드
    }
    // persist 없음
    const after = await prisma.reorderPlan.count({ where: { spaceId: SPACE_ID } })
    expect(after).toBe(before)
  })

  test('optionFinalOverrides — 편집한 최종수량이 그대로 persist(핵심 신규 경로)', async () => {
    const res = await POST(
      post({ productId, optionFinalOverrides: { [optAId]: 77, [optBId]: 33 } })
    )
    if (!res) throw new Error('응답 없음')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.planId).toBeTruthy()

    const items = await prisma.reorderPlanItem.findMany({
      where: { planId: json.planId },
      select: { optionId: true, finalQty: true },
    })
    const byOpt = new Map(items.map((i) => [i.optionId, i.finalQty]))
    expect(byOpt.get(optAId)).toBe(77) // override 반영
    expect(byOpt.get(optBId)).toBe(33)

    const plan = await prisma.reorderPlan.findUnique({
      where: { id: json.planId },
      select: { totalFinalQty: true, productId: true, locationId: true },
    })
    expect(plan?.totalFinalQty).toBe(110) // 77 + 33
    expect(plan?.productId).toBe(productId)
    expect(plan?.locationId).toBeNull()
  })
})
