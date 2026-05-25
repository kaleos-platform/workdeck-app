// 발주 예측 적중률 계산
//
// 평가 창: [stockedInAt, stockedInAt + leadTimeDays]
// 실제 출고 = 해당 기간 InvMovement OUTBOUND 합계
// 예측 출고 = dailyAvgForecast × leadTimeDays (bias 보정 전 원본 모델 출력 사용)
//
// WAPE = |forecast - actual| / actual (actual=0이면 0으로 처리)
// Bias% = (forecast - actual) / actual (양수=과예측, 음수=과소예측)
//
// stockoutDays / overstockDays 알고리즘:
//   - 입고 수량(finalQty)으로 시작, 매일 실제 출고량 차감
//   - stock ≤ 0인 날: stockoutDay
//   - stock > safetyStockQty + dailyAvgForecast × leadTimeDays인 날: overstockDay
//   (기준: 안전재고 + 1 리드타임 분 수요량 초과 시 과잉재고)

import { prisma } from '@/lib/prisma'

export type AccuracyInput = {
  planId: string
  optionId: string
  planItemId: string
  stockedInAt: Date // 입고 완료 시점
  leadTimeDays: number // 리드타임 (일)
  finalQty: number // 입고 수량
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
  const { optionId, stockedInAt, leadTimeDays, finalQty, dailyAvgForecast, safetyStockQty } = input

  const periodStart = new Date(stockedInAt)
  const periodEnd = new Date(stockedInAt)
  periodEnd.setDate(periodEnd.getDate() + leadTimeDays)

  // 평가 기간 내 일별 출고 조회
  const movements = await prisma.invMovement.findMany({
    where: {
      optionId,
      type: 'OUTBOUND',
      movementDate: { gte: periodStart, lt: periodEnd },
    },
    select: { movementDate: true, quantity: true },
    orderBy: { movementDate: 'asc' },
  })

  // 일별 집계
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

  // 총 실제 출고
  const actualOutbound = periodDays.reduce((sum, day) => sum + (dailyOutboundMap.get(day) ?? 0), 0)

  // 예측 출고 (원본 모델 출력 기반)
  const forecastOutbound = dailyAvgForecast * leadTimeDays

  // WAPE
  const wape = actualOutbound > 0 ? Math.abs(forecastOutbound - actualOutbound) / actualOutbound : 0

  // Bias% (양수=과예측)
  const bias = actualOutbound > 0 ? (forecastOutbound - actualOutbound) / actualOutbound : 0

  // ── 재고 시뮬레이션 ───────────────────────────────────────────────────────────
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
