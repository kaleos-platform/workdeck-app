// 발주 계획 입력 로더 — 발주 계획 라우트와 MCP 발주 계획 액션이 같은 입력으로 computeProductPlan 을 부른다.
// 재고(loadReorderStockInputs) + 주문수요(loadOptionDemand, 전 판매채널) + 품절일용 재고 순증감
// + 직전 정산 bias + 모델 실적(realized). 정산(settleEligiblePlans)·검증은 호출자 몫.

import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { computeBiasAdjust } from '@/lib/inv/forecast'
import { loadOptionDemand, loadSalesDemandChannels } from '@/lib/inv/option-demand'
import { isModelKey, type PlanOptionInput } from './plan-product'
import type { ModelKey } from './models'
import { kstYesterday, toKstDateKey } from './series'
import { loadReorderStockInputs, type ReorderStockInput } from './stock-inputs'

export const DEFAULT_PLAN_WINDOW_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

const EMPTY_STOCK: ReorderStockInput = {
  onHandQty: 0,
  rocketOnHandQty: 0,
  incomingQty: 0,
  rocketIncomingQty: 0,
  returnGradeQty: 0,
}

/**
 * 품절일 판정 입력 — 옵션×KST일 재고 순증감(전 위치 합, 오늘분 포함).
 * 입고·반품 +, 출고 −, 조정은 저장된 부호(delta), 위치 이동은 전 위치 합 0 이라 제외.
 */
export async function loadNetByDate(
  spaceId: string,
  optionIds: string[],
  since: Date
): Promise<Map<string, Record<string, number>>> {
  const netByOption = new Map<string, Record<string, number>>()
  if (optionIds.length === 0) return netByOption
  const movements = await prisma.invMovement.findMany({
    where: {
      spaceId,
      optionId: { in: optionIds },
      type: { not: 'TRANSFER' },
      movementDate: { gte: new Date(since.getTime() - DAY_MS) },
    },
    select: { optionId: true, type: true, quantity: true, movementDate: true },
  })
  for (const m of movements) {
    const delta = m.type === 'OUTBOUND' ? -m.quantity : m.quantity
    const key = toKstDateKey(m.movementDate)
    const net = netByOption.get(m.optionId) ?? {}
    net[key] = (net[key] ?? 0) + delta
    netByOption.set(m.optionId, net)
  }
  return netByOption
}

export type PlanLoaderProduct = {
  id: string
  options: { id: string; safetyStockQty: number; createdAt: Date }[]
  reorderConfig: { analysisWindowDays: number } | null
}

export async function loadPlanOptionInputs(args: {
  spaceId: string
  products: PlanLoaderProduct[]
  now: Date
  /** 레이어드 연동 위치. 미지정 = 쿠팡 로켓그로스 위치 */
  linkedLocationIds?: string[]
  /** 레이어드 수요 분할 키(로켓 채널 id). null = 비레이어드 */
  rocketChannelId: string | null
  /** 사용자 수요 보정계수 — bias 계수에 곱한다 */
  demandAdjustFactor?: number
}): Promise<{
  stockInputs: Map<string, ReorderStockInput>
  optionInputsByProduct: Map<string, PlanOptionInput[]>
  realizedByProduct: Map<string, Partial<Record<ModelKey | 'USER', number>> | undefined>
  windowDaysByOption: Map<string, number>
}> {
  const { spaceId, products, now, rocketChannelId } = args
  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))

  // 재고 입력 — onHandQty = 전 위치 − 반품 등급(음수 보존), incomingQty = 계획 차수 + 외부 입고 대기분
  const stockInputs = await loadReorderStockInputs(spaceId, optionIds, now, args.linkedLocationIds)

  const windowDaysByOption = new Map<string, number>()
  for (const p of products) {
    const wd = p.reorderConfig?.analysisWindowDays ?? DEFAULT_PLAN_WINDOW_DAYS
    for (const o of p.options) windowDaysByOption.set(o.id, wd)
  }

  // 주문수요(활성 판매채널 전체) — 최대 window 한 번 로드 후 옵션별로 자른다
  // (buildClosedSeries 가 옵션별 windowDays 로 zero-fill·절단).
  const maxWindowDays = Math.max(DEFAULT_PLAN_WINDOW_DAYS, ...windowDaysByOption.values())
  const since = new Date(now.getTime() - maxWindowDays * DAY_MS)
  const optionIdSet = new Set(optionIds)
  const yesterday = kstYesterday(now)
  const windowStartKey = (wd: number) =>
    new Date(Date.parse(`${yesterday}T00:00:00Z`) - (wd - 1) * DAY_MS).toISOString().slice(0, 10)

  const activeChannels = await loadSalesDemandChannels(spaceId)
  const demandRows = await loadOptionDemand(spaceId, since, now, activeChannels)

  // 옵션별 일별 수요(채널 합산) + 첫 수요일 + 창 내 로켓/전체 판매량(레이어드 비중)
  const dailyDemandByOption = new Map<string, Record<string, number>>()
  const firstDemandDateByOption = new Map<string, string>()
  const rocketQtyInWindowByOption = new Map<string, number>()
  const totalQtyInWindowByOption = new Map<string, number>()
  for (const id of optionIds) dailyDemandByOption.set(id, {})
  for (const row of demandRows) {
    if (!optionIdSet.has(row.optionId)) continue
    const byDate = dailyDemandByOption.get(row.optionId)!
    byDate[row.date] = (byDate[row.date] ?? 0) + row.quantity
    const first = firstDemandDateByOption.get(row.optionId)
    if (!first || row.date < first) firstDemandDateByOption.set(row.optionId, row.date)
    const wd = windowDaysByOption.get(row.optionId) ?? DEFAULT_PLAN_WINDOW_DAYS
    if (row.date < windowStartKey(wd) || row.date > yesterday) continue
    totalQtyInWindowByOption.set(
      row.optionId,
      (totalQtyInWindowByOption.get(row.optionId) ?? 0) + row.quantity
    )
    if (rocketChannelId != null && row.channelId === rocketChannelId) {
      rocketQtyInWindowByOption.set(
        row.optionId,
        (rocketQtyInWindowByOption.get(row.optionId) ?? 0) + row.quantity
      )
    }
  }

  const netByOption = await loadNetByDate(spaceId, optionIds, since)

  // ACTIVE accuracy 가 채워진 가장 최근 확정 계획의 bias.
  // validity=ACTIVE 만 — revert 로 SUPERSEDED/INVALIDATED 된 측정값은 학습에서 제외.
  const lastSettled = await prisma.reorderPlan.findFirst({
    where: { spaceId, accuracies: { some: { validity: 'ACTIVE' } } },
    orderBy: { confirmedAt: 'desc' },
    select: {
      accuracies: { where: { validity: 'ACTIVE' }, select: { optionId: true, bias: true } },
    },
  })
  const biasByOption = new Map<string, number>()
  for (const acc of lastSettled?.accuracies ?? []) biasByOption.set(acc.optionId, Number(acc.bias))

  // 모델 실적 — 상품의 최근 정산 계획(ACTIVE·MEASURED) 3건 modelWape 평균 → 추천 점수에 반영
  const accuracyRows = await prisma.reorderPlanAccuracy.findMany({
    where: {
      optionId: { in: optionIds },
      plan: { spaceId },
      validity: 'ACTIVE',
      evaluationStatus: 'MEASURED',
      modelWape: { not: Prisma.AnyNull },
    },
    orderBy: { evaluatedAt: 'desc' },
    select: { planId: true, optionId: true, modelWape: true },
  })
  const realizedFor = (
    productOptionIds: Set<string>
  ): Partial<Record<ModelKey | 'USER', number>> | undefined => {
    // 최신순 정렬된 행에서 이 상품의 최근 정산 계획 3건을 고르고, 그 계획들의 옵션 행을 모두 쓴다
    const productRows = accuracyRows.filter((r) => productOptionIds.has(r.optionId))
    const planIds = new Set(Array.from(new Set(productRows.map((r) => r.planId))).slice(0, 3))
    const rows = productRows.filter((r) => planIds.has(r.planId))
    const sum: Record<string, { s: number; n: number }> = {}
    for (const r of rows) {
      const w = r.modelWape
      if (w == null || typeof w !== 'object' || Array.isArray(w)) continue
      for (const [k, v] of Object.entries(w)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        if (!isModelKey(k) && k !== 'USER') continue
        sum[k] = { s: (sum[k]?.s ?? 0) + v, n: (sum[k]?.n ?? 0) + 1 }
      }
    }
    const keys = Object.keys(sum)
    if (keys.length === 0) return undefined
    return Object.fromEntries(keys.map((k) => [k, sum[k].s / sum[k].n]))
  }

  const optionInputsByProduct = new Map<string, PlanOptionInput[]>()
  const realizedByProduct = new Map<
    string,
    Partial<Record<ModelKey | 'USER', number>> | undefined
  >()
  for (const p of products) {
    realizedByProduct.set(p.id, realizedFor(new Set(p.options.map((o) => o.id))))
    optionInputsByProduct.set(
      p.id,
      p.options.map((o) => {
        // 이력 시작 = 창 내 첫 수요일과 옵션 생성일(KST) 중 이른 날. 창 밖 판매만 있던 옵션도
        // 생성일이 오래면 신상품으로 보지 않는다.
        const createdKey = toKstDateKey(o.createdAt)
        const firstDemand = firstDemandDateByOption.get(o.id)
        const startKey = firstDemand && firstDemand < createdKey ? firstDemand : createdKey
        const historyDays =
          Math.round(
            (Date.parse(`${yesterday}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / DAY_MS
          ) + 1
        return {
          optionId: o.id,
          qtyByDate: dailyDemandByOption.get(o.id) ?? {},
          netByDate: netByOption.get(o.id) ?? {},
          rocketQtyInWindow: rocketQtyInWindowByOption.get(o.id) ?? 0,
          totalQtyInWindow: totalQtyInWindowByOption.get(o.id) ?? 0,
          historyDays,
          safetyStockQty: o.safetyStockQty,
          stock: stockInputs.get(o.id) ?? EMPTY_STOCK,
          biasFactor:
            computeBiasAdjust(biasByOption.get(o.id) ?? null) * (args.demandAdjustFactor ?? 1),
        }
      })
    )
  }

  return { stockInputs, optionInputsByProduct, realizedByProduct, windowDaysByOption }
}
