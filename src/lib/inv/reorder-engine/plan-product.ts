// 상품 단위 발주 계산 (순수 함수) — 시계열·품절일 → 모델 비교 → 백테스트 추천 → 선택 → 수량·레이어드 분할

import { computeLayeredRoundedSplit } from '@/lib/sh/set-plan-calc'
import { backtestProduct, recommendModel } from './backtest'
import { forecastRates, type ModelKey } from './models'
import { computeOrderQty } from './order-qty'
import { buildForecastSeries } from './series'
import type { ReorderStockInput } from './stock-inputs'

export const MODEL_KEYS: ModelKey[] = ['MA30', 'MA90', 'MA_BLEND', 'SES_TREND', 'CROSTON']
/** 이력이 이 일수 미만이면 신상품 옵션 — 모델 대신 수동 수량 */
export const NEW_OPTION_HISTORY_DAYS = 60

export type SelectedModel = ModelKey | 'MANUAL'

export function isModelKey(v: unknown): v is ModelKey {
  return typeof v === 'string' && (MODEL_KEYS as string[]).includes(v)
}

export type PlanOptionInput = {
  optionId: string
  /** KST 일자별 판매 수요 */
  qtyByDate: Record<string, number>
  /** KST 일자별 재고 순증감(전 위치 합) — 품절일 판정용 */
  netByDate: Record<string, number>
  rocketQtyInWindow: number
  totalQtyInWindow: number
  historyDays: number
  safetyStockQty: number
  /** onHandQty 는 반품 등급 차감 후(음수 가능). 원재고 = onHandQty + returnGradeQty */
  stock: ReorderStockInput
  biasFactor: number
}

export type PlanProductInput = {
  leadTimeDays: number
  targetCoverDays: number
  roundUnit: number
  windowDays: number
  configModel: ModelKey | null
  overrideModel?: SelectedModel
  realized?: Partial<Record<ModelKey | 'USER', number>>
  layered: boolean
}

export type ModelForecastsJson = {
  rates: Record<ModelKey, number>
  selected: SelectedModel
  onHandQty: number
  incomingQty: number
  safetyStockQty: number
  horizonDays: number
  leadTimeDays: number
}

export type PlanOptionResult = {
  optionId: string
  /** dailyRate = 모델 원본 일률(bias 전), qty = bias 반영 라운딩 수량 */
  models: Record<ModelKey, { dailyRate: number; qty: number }>
  backtestWape: Record<ModelKey, number | null>
  recommendedModel: ModelKey
  selectedModel: SelectedModel
  targetCoverDays: number
  checkStock: boolean
  isNewOption: boolean
  siblingAvgRate: number | null
  /** 선택 모델 원본 일률(bias 전). MANUAL = siblingAvgRate ?? 0 */
  dailyRate: number
  suggestedQty: number
  roundedSuggestedQty: number
  finalQty: number
  /** 레이어드 분할(비레이어드 = null) */
  layered: {
    rocketExpectedSales: number
    rocketSafetyStock: number
    linkedLocationNeedQty: number
    linkedLocationQty: number
    remainingQty: number
  } | null
  modelForecasts: ModelForecastsJson
}

export function computeProductPlan(input: {
  options: PlanOptionInput[]
  product: PlanProductInput
  manualQtyByOption?: Record<string, number>
  now: Date
}): PlanOptionResult[] {
  const { options, product, now } = input
  const manual = input.manualQtyByOption ?? {}
  const horizonDays = product.leadTimeDays + product.targetCoverDays

  const prepared = options.map((o) => {
    const series = buildForecastSeries({
      qtyByDate: o.qtyByDate,
      netByDate: o.netByDate,
      currentStock: o.stock.onHandQty + o.stock.returnGradeQty,
      windowDays: product.windowDays,
      now,
    })
    return {
      o,
      series,
      isNew: o.historyDays < NEW_OPTION_HISTORY_DAYS,
      rates: forecastRates(series, horizonDays),
    }
  })

  const established = prepared.filter((p) => !p.isNew)
  const backtest = backtestProduct(
    established.map((p) => p.series),
    horizonDays
  )
  const recommended = recommendModel(backtest, product.realized).model
  const productModel: SelectedModel = product.overrideModel ?? product.configModel ?? recommended
  // 상품 전체 MANUAL 이면 형제 평균은 추천 모델 기준
  const rateModel: ModelKey = productModel === 'MANUAL' ? recommended : productModel
  const siblingAvgRate =
    established.length === 0
      ? null
      : established.reduce((s, p) => s + p.rates[rateModel], 0) / established.length

  return prepared.map(({ o, isNew, rates }) => {
    const qtyFor = (rate: number) =>
      computeOrderQty({
        dailyRate: rate * o.biasFactor,
        leadTimeDays: product.leadTimeDays,
        targetCoverDays: product.targetCoverDays,
        safetyStockQty: o.safetyStockQty,
        onHandQty: o.stock.onHandQty,
        incomingQty: o.stock.incomingQty,
        roundUnit: product.roundUnit,
      })
    const models = {} as Record<ModelKey, { dailyRate: number; qty: number }>
    for (const k of MODEL_KEYS)
      models[k] = { dailyRate: rates[k], qty: qtyFor(rates[k]).roundedQty }

    const selectedModel: SelectedModel = isNew ? 'MANUAL' : productModel
    let dailyRate: number
    let suggestedQty: number
    let roundedSuggestedQty: number
    let layered: PlanOptionResult['layered'] = null
    let finalQty: number

    if (selectedModel === 'MANUAL') {
      // 수동 수량은 입력값 그대로(라운딩 없음), 레이어드면 전량 나머지 위치
      const qty = Math.max(0, Math.floor(manual[o.optionId] ?? 0))
      dailyRate = siblingAvgRate ?? 0
      suggestedQty = qty
      roundedSuggestedQty = qty
      finalQty = qty
      if (product.layered) {
        layered = {
          rocketExpectedSales: 0,
          rocketSafetyStock: 0,
          linkedLocationNeedQty: 0,
          linkedLocationQty: 0,
          remainingQty: qty,
        }
      }
    } else {
      dailyRate = rates[selectedModel]
      const r = qtyFor(dailyRate)
      suggestedQty = r.suggestedQty
      roundedSuggestedQty = r.roundedQty
      finalQty = r.roundedQty
      if (product.layered) {
        const share = o.totalQtyInWindow > 0 ? o.rocketQtyInWindow / o.totalQtyInWindow : 0
        const rocketGross = r.gross * share
        const rocketSafetyStock = o.safetyStockQty * share
        const split = computeLayeredRoundedSplit({
          rocketGross,
          directGross: r.gross - rocketGross,
          safetyStockQty: o.safetyStockQty,
          linkedLocationSafetyStockQty: rocketSafetyStock,
          // computeOrderQty 와 같은 기준(음수 현재고는 0)
          totalPlannedStock: Math.max(o.stock.onHandQty, 0) + o.stock.incomingQty,
          rocketPlannedStock: o.stock.rocketOnHandQty + o.stock.rocketIncomingQty,
          roundUnit: product.roundUnit,
        })
        finalQty = split.finalQty
        layered = {
          rocketExpectedSales: rocketGross,
          rocketSafetyStock,
          linkedLocationNeedQty: split.linkedLocationNeedQty,
          linkedLocationQty: split.linkedLocationQty,
          remainingQty: split.remainingQty,
        }
      }
    }

    return {
      optionId: o.optionId,
      models,
      backtestWape: backtest,
      recommendedModel: recommended,
      selectedModel,
      targetCoverDays: product.targetCoverDays,
      checkStock: o.stock.onHandQty < 0,
      isNewOption: isNew,
      siblingAvgRate: isNew ? siblingAvgRate : null,
      dailyRate,
      suggestedQty,
      roundedSuggestedQty,
      finalQty,
      layered,
      modelForecasts: {
        rates,
        selected: selectedModel,
        onHandQty: o.stock.onHandQty,
        incomingQty: o.stock.incomingQty,
        safetyStockQty: o.safetyStockQty,
        horizonDays,
        leadTimeDays: product.leadTimeDays,
      },
    }
  })
}
