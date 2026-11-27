// velocity 도구 생산 판단 = 발주 엔진(computeProductPlan) — 모델·일률·수량·라운딩·신상품
jest.mock('@/lib/prisma', () => ({
  prisma: {
    channel: { findMany: jest.fn() },
    invProduct: { findMany: jest.fn() },
    invProductOption: { findMany: jest.fn() },
    invStorageLocation: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/inv/option-demand', () => ({
  loadOptionDemand: jest.fn(),
  loadSalesDemandChannels: jest.fn(),
}))
jest.mock('@/lib/inv/coupang-return-stock', () => ({
  getCoupangReturnStockByOption: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/inv/reorder-engine', () => ({
  ...jest.requireActual('@/lib/inv/reorder-engine'),
  loadReorderStockInputs: jest.fn(),
  loadNetByDate: jest.fn(),
  loadPlanOptionInputs: jest.fn(),
}))

import { prisma } from '@/lib/prisma'
import { loadOptionDemand, loadSalesDemandChannels } from '@/lib/inv/option-demand'
import {
  computeProductPlan,
  loadNetByDate,
  loadPlanOptionInputs,
  loadReorderStockInputs,
  type PlanOptionInput,
} from '@/lib/inv/reorder-engine'
import { addDaysYmd, lastClosedDateKst } from '@/lib/sh/sales-analytics'
import { queryOptionSalesVelocity } from '@/lib/sh/option-velocity-query'

const p = prisma as unknown as {
  channel: { findMany: jest.Mock }
  invProduct: { findMany: jest.Mock }
  invProductOption: { findMany: jest.Mock }
  invStorageLocation: { findMany: jest.Mock }
}

const channel = { id: 'ch-direct', name: '자사몰', externalSource: null }
const stock = (onHandQty: number) => ({
  onHandQty,
  rocketOnHandQty: 0,
  incomingQty: 0,
  rocketIncomingQty: 0,
  returnGradeQty: 0,
})

/** 마감일 기준 i일 전 판매 qty(i)를 만든다 */
function demand(days: number, qty: (i: number) => number): Record<string, number> {
  const to = lastClosedDateKst()
  const out: Record<string, number> = {}
  for (let i = 0; i < days; i++) {
    const q = qty(i)
    if (q > 0) out[addDaysYmd(to, -i)] = q
  }
  return out
}

function optionInput(
  id: string,
  qtyByDate: Record<string, number>,
  onHand: number,
  over: Partial<PlanOptionInput> = {}
): PlanOptionInput {
  const total = Object.values(qtyByDate).reduce((s, v) => s + v, 0)
  return {
    optionId: id,
    qtyByDate,
    netByDate: {},
    rocketQtyInWindow: 0,
    totalQtyInWindow: total,
    historyDays: 200,
    safetyStockQty: 0,
    stock: stock(onHand),
    biasFactor: 1,
    ...over,
  }
}

/** velocity 가 보는 옵션(필터 결과) + 엔진 입력(상품 전 옵션)을 세팅 */
function setup(args: {
  visible: string[]
  inputs: PlanOptionInput[]
  roundUnit?: number
  forecastModel?: string | null
}) {
  const reorderConfig = args.forecastModel
    ? {
        leadTimeDays: 20,
        analysisWindowDays: 90,
        targetCoverDays: 30,
        excludeFromForecast: false,
        forecastModel: args.forecastModel,
      }
    : null
  p.channel.findMany.mockResolvedValue([channel])
  ;(loadSalesDemandChannels as jest.Mock).mockResolvedValue([channel])
  p.invStorageLocation.findMany.mockResolvedValue([
    { id: 'loc-office', type: 'OWN', externalSource: null },
  ])
  const byId = new Map(args.inputs.map((i) => [i.optionId, i]))
  p.invProductOption.findMany.mockResolvedValue(
    args.visible.map((id) => ({
      id,
      name: id,
      sku: id,
      safetyStockQty: 0,
      costPrice: null,
      costVatIncluded: false,
      status: 'ACTIVE',
      product: {
        id: 'prod-1',
        name: '상품',
        internalName: null,
        reorderRoundUnit: args.roundUnit ?? 10,
        reorderConfig,
      },
      stockLevels: [{ locationId: 'loc-office', quantity: byId.get(id)!.stock.onHandQty }],
    }))
  )
  p.invProduct.findMany.mockResolvedValue([
    {
      id: 'prod-1',
      reorderRoundUnit: args.roundUnit ?? 10,
      reorderConfig,
      options: args.inputs.map((i) => ({
        id: i.optionId,
        safetyStockQty: 0,
        createdAt: new Date(0),
      })),
    },
  ])
  ;(loadPlanOptionInputs as jest.Mock).mockResolvedValue({
    stockInputs: new Map(args.inputs.map((i) => [i.optionId, i.stock])),
    optionInputsByProduct: new Map([['prod-1', args.inputs]]),
    realizedByProduct: new Map(),
    windowDaysByOption: new Map(),
  })
  ;(loadReorderStockInputs as jest.Mock).mockResolvedValue(
    new Map(args.inputs.map((i) => [i.optionId, i.stock]))
  )
  ;(loadNetByDate as jest.Mock).mockResolvedValue(new Map())
  ;(loadOptionDemand as jest.Mock).mockResolvedValue(
    args.inputs.flatMap((i) =>
      Object.entries(i.qtyByDate).map(([date, quantity]) => ({
        optionId: i.optionId,
        channelId: channel.id,
        date,
        quantity,
      }))
    )
  )
}

const engine = (inputs: PlanOptionInput[], roundUnit = 10) =>
  computeProductPlan({
    options: inputs,
    product: {
      leadTimeDays: 20,
      targetCoverDays: 30,
      roundUnit,
      windowDays: 90,
      configModel: null,
      layered: false,
    },
    now: new Date(),
  })

describe('queryOptionSalesVelocity — 발주 엔진 정합', () => {
  beforeEach(() => jest.clearAllMocks())

  it('필요량이 발주 단위 절반 미만(BGE-S: 일률 0.01·재고 0)이면 권장 0·OK, 생산 필요 필터에서 빠진다', async () => {
    const inputs = [
      optionInput(
        'opt-s',
        demand(90, (i) => (i === 45 ? 1 : 0)),
        0,
        // 어제 5개 출고(판매 외) → 과거 재고 5개로 품절일 아님, 현재고 0
        { netByDate: { [lastClosedDateKst()]: -5 } }
      ),
    ]
    setup({ visible: ['opt-s'], inputs })
    const plan = engine(inputs)[0]
    expect(plan.finalQty).toBe(0)

    const res = await queryOptionSalesVelocity('space-1', { channel: 'all' })
    const row = res.rows[0]
    expect(row.suggestedProductionQty).toBe(0)
    expect(row.productionStatus).toBe('OK')
    expect(row.productionStatusReason).toContain('발주 단위 절반')

    const only = await queryOptionSalesVelocity('space-1', {
      channel: 'all',
      onlyNeedsProduction: true,
    })
    expect(only.rows).toHaveLength(0)
  })

  it('모델 미설정 상품은 엔진 백테스트 추천 모델·일률·수량을 그대로 쓴다(보이는 옵션이 일부여도 상품 전 옵션 기준)', async () => {
    // 최근 급증(앞 60일 1개/일 → 최근 30일 6개/일) — MA_BLEND 와 5%p 이상 차이 나는 추천이 나오는 입력
    const inputs = [
      optionInput(
        'opt-a',
        demand(90, (i) => (i < 30 ? 6 : 1)),
        20
      ),
      optionInput(
        'opt-b',
        demand(90, (i) => (i < 30 ? 4 : 1)),
        10,
        { biasFactor: 1.2 }
      ),
    ]
    setup({ visible: ['opt-a'], inputs })
    const plans = engine(inputs)
    const planA = plans.find((x) => x.optionId === 'opt-a')!

    const res = await queryOptionSalesVelocity('space-1', { channel: 'all' })
    const row = res.rows[0]
    expect(row.optionId).toBe('opt-a')
    expect(row.recommendedModel).toBe(planA.recommendedModel)
    expect(row.forecastModel).toBe(planA.recommendedModel)
    expect(row.productionDailyRate).toBeCloseTo(planA.dailyRate, 2)
    expect(row.suggestedProductionQty).toBe(planA.finalQty)
    expect(row.suggestedProductionQty % 10).toBe(0)
    expect(row.roundUnit).toBe(10)
  })

  it('bias 계수도 엔진과 같게 수량에 반영된다', async () => {
    const inputs = [
      optionInput(
        'opt-a',
        demand(90, () => 3),
        10,
        { biasFactor: 1.5 }
      ),
    ]
    setup({ visible: ['opt-a'], inputs, roundUnit: 1 })
    const plan = engine(inputs, 1)[0]
    const res = await queryOptionSalesVelocity('space-1', { channel: 'all' })
    expect(res.rows[0].suggestedProductionQty).toBe(plan.finalQty)
    // bias 없이 계산한 값(3 × 50 − 10 = 140)과 다르다
    expect(plan.finalQty).toBeGreaterThan(140)
  })

  it('설정 모델이 있으면 그 모델을 쓴다', async () => {
    const inputs = [
      optionInput(
        'opt-a',
        demand(90, (i) => (i < 30 ? 6 : 1)),
        20
      ),
    ]
    setup({ visible: ['opt-a'], inputs, forecastModel: 'MA90' })
    const res = await queryOptionSalesVelocity('space-1', { channel: 'all' })
    expect(res.rows[0].forecastModel).toBe('MA90')
  })

  it('신상품 옵션(이력 60일 미만)은 엔진처럼 권장 0, 생산이 필요해 보이면 NEW_OPTION', async () => {
    const inputs = [
      optionInput(
        'opt-old',
        demand(90, () => 2),
        300
      ),
      optionInput(
        'opt-new',
        demand(20, () => 3),
        0,
        { historyDays: 20 }
      ),
    ]
    setup({ visible: ['opt-new'], inputs })
    const planNew = engine(inputs).find((x) => x.optionId === 'opt-new')!
    expect(planNew.selectedModel).toBe('MANUAL')
    expect(planNew.finalQty).toBe(0)

    const res = await queryOptionSalesVelocity('space-1', {
      channel: 'all',
      onlyNeedsProduction: true,
    })
    const row = res.rows[0]
    expect(row.suggestedProductionQty).toBe(0)
    expect(row.productionStatus).toBe('NEW_OPTION')
    expect(res.summary.productionStatusCounts.NEW_OPTION).toBe(1)
    expect(
      (res.summary as { totalSuggestedProductionQty?: number }).totalSuggestedProductionQty
    ).toBe(0)
  })
})
