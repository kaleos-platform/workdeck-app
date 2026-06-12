// 발주 예측 적중률 계산
//
// 평가 창: [anchorDate, anchorDate + leadTimeDays]
//   anchorDate = 예측 검증 시작(확정) 시점(confirmedAt) — 순수 예측 검증.
//   (구 모델은 생산차수 입고일 stockedInAt 기준이었으나, 재고 가용성이 아닌
//    예측 품질을 측정하기 위해 계획 동결 시점으로 재앵커.)
//
// 두 baseline 분리 (예측 입력이 OUTBOUND 장부 → 주문수요로 바뀐 데 맞춤):
//   - WAPE/bias 의 actual = 주문수요(loadOptionDemand, 수동 DelOrderItem + 로켓 VENDOR).
//     예측 입력(reorder plan)이 같은 주문수요라 forecast 와 actual 이 같은 척도여야 정합.
//   - stockoutDays/overstockDays 의 실제 소진 = 물리적 출고(InvMovement OUTBOUND).
//     재고 소진/과잉은 물리적 재고 이벤트이므로 OUTBOUND 기준 유지.
//
// 예측 출고 = dailyAvgForecast × leadTimeDays (bias 보정 전 원본 모델 출력 사용)
// WAPE = |forecast - actual| / actual (actual=0이면 0으로 처리)
// Bias% = (forecast - actual) / actual (양수=과예측, 음수=과소예측)
//
// stockoutDays / overstockDays 알고리즘:
//   - 입고 수량(finalQty)으로 시작, 매일 물리적 출고량(OUTBOUND) 차감
//   - stock ≤ 0인 날: stockoutDay
//   - stock > safetyStockQty + dailyAvgForecast × leadTimeDays인 날: overstockDay
//   (기준: 안전재고 + 1 리드타임 분 수요량 초과 시 과잉재고)

import { prisma } from '@/lib/prisma'
import { loadOptionDemand } from '@/lib/inv/option-demand'

export type AccuracyInput = {
  spaceId: string // 주문수요 baseline 로드용 (loadOptionDemand)
  planId: string
  optionId: string
  planItemId: string
  anchorDate: Date // 평가창 시작점 = 예측 검증 시작(confirmedAt)
  leadTimeDays: number // 리드타임 (일)
  finalQty: number // 최종 수량 (재고 시뮬레이션 시작값)
  dailyAvgForecast: number // 예측 일평균 (모델 원본, bias 보정 전)
  safetyStockQty: number // 안전재고
}

export type AccuracyResult = {
  actualOutbound: number
  forecastOutbound: number
  wape: number
  bias: number
  stockoutDays: number
  overstockDays: number
}

export async function computeAccuracy(input: AccuracyInput): Promise<AccuracyResult> {
  const {
    spaceId,
    optionId,
    anchorDate,
    leadTimeDays,
    finalQty,
    dailyAvgForecast,
    safetyStockQty,
  } = input

  const periodStart = new Date(anchorDate)
  const periodEnd = new Date(anchorDate)
  periodEnd.setDate(periodEnd.getDate() + leadTimeDays)

  // ── baseline 1) 주문수요 (WAPE/bias 용) ──────────────────────────────────────
  // 예측 입력(reorder plan)과 동일한 loadOptionDemand → forecast 와 같은 척도.
  const activeChannels = await prisma.channel.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, externalSource: true },
  })
  const demandRows = await loadOptionDemand(spaceId, periodStart, periodEnd, activeChannels)
  const dailyDemandMap = new Map<string, number>()
  for (const row of demandRows) {
    if (row.optionId !== optionId) continue
    dailyDemandMap.set(row.date, (dailyDemandMap.get(row.date) ?? 0) + row.quantity)
  }

  // ── baseline 2) 물리적 출고 OUTBOUND (재고 시뮬레이션 용) ──────────────────────
  const movements = await prisma.invMovement.findMany({
    where: {
      optionId,
      type: 'OUTBOUND',
      movementDate: { gte: periodStart, lt: periodEnd },
    },
    select: { movementDate: true, quantity: true },
    orderBy: { movementDate: 'asc' },
  })
  const dailyOutboundMap = new Map<string, number>()
  for (const mv of movements) {
    const key = toDateStr(mv.movementDate)
    dailyOutboundMap.set(key, (dailyOutboundMap.get(key) ?? 0) + mv.quantity)
  }

  // 평가 기간 연속 날짜 배열 생성
  const periodDays: string[] = []
  for (let i = 0; i < leadTimeDays; i++) {
    const d = new Date(periodStart)
    d.setDate(d.getDate() + i)
    periodDays.push(toDateStr(d))
  }

  // 총 실제 수요 (WAPE/bias 의 actual). demand 맵은 KST 키, periodDays 는 local 키라
  // 경계 1일 어긋날 수 있어 기간 합으로 집계(특정일 조회가 아닌 전체 합 → 경계 영향 최소).
  const actualOutbound = Array.from(dailyDemandMap.values()).reduce((s, q) => s + q, 0)

  // 예측 출고 (원본 모델 출력 기반)
  const forecastOutbound = dailyAvgForecast * leadTimeDays

  // WAPE
  const wape = actualOutbound > 0 ? Math.abs(forecastOutbound - actualOutbound) / actualOutbound : 0

  // Bias% (양수=과예측)
  const bias = actualOutbound > 0 ? (forecastOutbound - actualOutbound) / actualOutbound : 0

  // ── 재고 시뮬레이션 (물리적 OUTBOUND 기준) ────────────────────────────────────
  // 과잉재고 기준: 안전재고 + 1 리드타임 분 예상 수요
  const overstockThreshold = safetyStockQty + dailyAvgForecast * leadTimeDays

  let stock = finalQty
  let stockoutDays = 0
  let overstockDays = 0

  for (const day of periodDays) {
    const dayOutbound = dailyOutboundMap.get(day) ?? 0

    if (stock <= 0) {
      stockoutDays++
    } else if (stock > overstockThreshold) {
      overstockDays++
    }

    stock -= dayOutbound
  }

  return {
    actualOutbound,
    forecastOutbound,
    wape,
    bias,
    stockoutDays,
    overstockDays,
  }
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
