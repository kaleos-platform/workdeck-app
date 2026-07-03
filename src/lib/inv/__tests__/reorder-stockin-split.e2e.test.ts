/**
 * 입고 분배 프리필 엔드포인트 e2e — GET /production-runs/[runId]/stockin-split.
 *
 * 레이어드 발주 차수의 옵션별 baseline(min(발주수량, ceil(rocketGross))) / 추가분(발주−baseline) 분할과
 * 로켓 위치 반환을 실제 라우트 핸들러로 검증. throwaway space 에 플랜·차수를 직접 시드(감지 로직 불필요).
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
import { GET } from '../../../../app/api/sh/production-runs/[runId]/stockin-split/route'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'
const ROCKET = 'coupang_rocket_growth'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

let runId = ''
let optAId = ''
let optBId = ''
let rocketLocId = ''

async function cleanup() {
  await prisma.productionRunItem.deleteMany({ where: { run: { spaceId: SPACE_ID } } })
  await prisma.productionRun.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.reorderPlanItem.deleteMany({ where: { plan: { spaceId: SPACE_ID } } })
  await prisma.reorderPlan.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invStorageLocation.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

async function planItem(planId: string, optionId: string, rocketGrossQty: number, finalQty: number) {
  await prisma.reorderPlanItem.create({
    data: {
      planId,
      optionId,
      productId: (await prisma.invProductOption.findUnique({ where: { id: optionId } }))!.productId,
      currentStock: 0,
      dailyAvgForecast: 0,
      forecastModel: 'SMA',
      leadTimeDays: 7,
      safetyStockQty: 0,
      suggestedQty: finalQty,
      roundedSuggestedQty: finalQty,
      finalQty,
      roundUnit: 10,
      biasAdjustFactor: 1,
      rocketGrossQty,
      inputsSnapshot: {},
    },
  })
}

d('GET /production-runs/[runId]/stockin-split — 레이어드 baseline/추가분 분할 (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({
      data: { id: SPACE_ID, name: 'E2E StockinSplit', type: 'PERSONAL' },
    })
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-split@throwaway.test' } })
    const group = await prisma.invProductGroup.create({ data: { spaceId: SPACE_ID, name: '기본' } })
    const product = await prisma.invProduct.create({
      data: { spaceId: SPACE_ID, name: 'E2E 레이어드상품', groupId: group.id, status: 'ACTIVE' },
    })
    optAId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'A' } })).id
    optBId = (await prisma.invProductOption.create({ data: { productId: product.id, name: 'B' } })).id
    rocketLocId = (
      await prisma.invStorageLocation.create({
        data: { spaceId: SPACE_ID, name: 'E2E 로켓그로스', type: 'THIRD_PARTY', externalSource: ROCKET },
      })
    ).id
    // 레이어드 플랜(productId 세트, locationId null) + 옵션별 rocketGross
    const plan = await prisma.reorderPlan.create({
      data: {
        spaceId: SPACE_ID,
        planNo: 'E2E-SPLIT-001',
        productId: product.id,
        windowDays: 90,
        createdById: USER_ID,
        totalSuggestedQty: 120,
        totalFinalQty: 120,
      },
    })
    await planItem(plan.id, optAId, 30, 100) // baseline ceil(30)=30, 발주 100 → 추가 70
    await planItem(plan.id, optBId, 50, 20) // baseline min(20, ceil(50))=20, 추가 0
    // 이 플랜에서 생성된 생산 차수 (발주수량 = finalQty)
    const run = await prisma.productionRun.create({
      data: {
        spaceId: SPACE_ID,
        runNo: 'E2E-RUN-001',
        reorderPlanId: plan.id,
        items: {
          create: [
            { optionId: optAId, quantity: 100 },
            { optionId: optBId, quantity: 20 },
          ],
        },
      },
    })
    runId = run.id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID, name: 'E2E StockinSplit' },
      user: { id: USER_ID },
    })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('옵션별 baseline=min(발주,ceil(rocketGross)) / 추가분=발주−baseline + 로켓 위치 반환', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ runId }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.layered).toBe(true)
    expect(json.rocketLocation?.id).toBe(rocketLocId)

    const byOpt = new Map(
      json.options.map((o: { optionId: string; baselineQty: number; additionalQty: number }) => [
        o.optionId,
        o,
      ])
    )
    expect(byOpt.get(optAId)).toEqual({ optionId: optAId, baselineQty: 30, additionalQty: 70 })
    expect(byOpt.get(optBId)).toEqual({ optionId: optBId, baselineQty: 20, additionalQty: 0 })
  })
})
