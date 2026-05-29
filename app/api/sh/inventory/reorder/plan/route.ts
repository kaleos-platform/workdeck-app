// POST /api/sh/inventory/reorder/plan
// DRAFT 발주 계획 생성
//
// 흐름:
//  1) 옵션별 history(OUTBOUND) + currentStock + config + safetyStock + roundUnit 로드
//  2) 직전 FINALIZED 계획의 accuracy bias → biasAdjust 계수 계산
//  3) forecastOption → suggestedQty 계산 (bias 보정 + roundUnit 반올림)
//  4) LLM rationale 생성 (실패 시 결정론적 폴백 텍스트)
//  5) ReorderPlan + ReorderPlanItem 트랜잭션 저장
//  6) { planId, items } 응답

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { forecastOption, buildDailySeries, computeBiasAdjust } from '@/lib/inv/forecast'
import { generateTextWithFallback } from '@/lib/ai/providers'
import { roundUp } from '@/lib/inv/round'

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7

// ─── planNo 생성 (yyyyMMdd-NNN) ────────────────────────────────────────────────

async function generatePlanNo(
  spaceId: string,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<string> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const dateStr = `${y}${m}${day}`

  const count = await tx.reorderPlan.count({
    where: {
      spaceId,
      createdAt: { gte: today },
    },
  })

  return `${dateStr}-${String(count + 1).padStart(3, '0')}`
}

// LLM 동시 호출 상한 (rate limit 방어)
const LLM_CONCURRENCY = 5

// 입력 배열을 limit개씩 동시 처리하며 입력 순서를 보존해 결과 반환
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

// ─── LLM rationale 생성 ────────────────────────────────────────────────────────

async function generateRationale(params: {
  model: string
  dailyAvg: number
  leadTime: number
  safetyStock: number
  currentStock: number
  profile: string
}): Promise<string> {
  const { model, dailyAvg, leadTime, safetyStock, currentStock, profile } = params

  // 결정론적 폴백 텍스트 (LLM 호출 전 기본값)
  const fallback = `${model} 모델(${profile}) 기반 일평균 ${dailyAvg.toFixed(2)}개 예측, 리드타임 ${leadTime}일 + 안전재고 ${safetyStock}개 적용 (현재재고 ${currentStock}개).`

  try {
    const { result } = await generateTextWithFallback({
      system:
        '당신은 재고 관리 전문가입니다. 발주 수량 근거를 한국어로 간결하게 1~2문장으로 작성하세요.',
      messages: [
        {
          role: 'user',
          content: `예측 모델: ${model} (${profile}), 일평균 소진량: ${dailyAvg.toFixed(2)}개, 리드타임: ${leadTime}일, 안전재고: ${safetyStock}개, 현재재고: ${currentStock}개. 이 데이터를 바탕으로 발주 수량의 근거를 설명해주세요.`,
        },
      ],
      maxTokens: 120,
      temperature: 0.3,
    })
    return result.content.trim() || fallback
  } catch {
    return fallback
  }
}

// ─── 수량 라운딩 ──────────────────────────────────────────────────────────────

// ─── POST 핸들러 ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const userId = resolved.user.id

  // 요청 바디 (옵션 필터)
  let body: { productId?: string; brandId?: string; memo?: string } = {}
  try {
    body = await req.json()
  } catch {
    // 빈 바디 허용
  }

  // ── 1) 상품/옵션 로드 ──────────────────────────────────────────────────────
  const productWhere: Record<string, unknown> = { spaceId, status: 'ACTIVE' }
  if (body.productId) productWhere.id = body.productId
  if (body.brandId && body.brandId !== 'all') {
    productWhere.brandId = body.brandId === 'none' ? null : body.brandId
  }

  const products = await prisma.invProduct.findMany({
    where: productWhere,
    select: {
      id: true,
      brandId: true,
      reorderRoundUnit: true,
      options: {
        select: { id: true, safetyStockQty: true },
      },
      reorderConfig: {
        select: { leadTimeDays: true, analysisWindowDays: true },
      },
    },
  })

  if (products.length === 0) {
    return errorResponse('예측 대상 상품이 없습니다', 422)
  }

  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))

  // ── 2) 현재 재고 ──────────────────────────────────────────────────────────
  const stockGroups = await prisma.invStockLevel.groupBy({
    by: ['optionId'],
    where: { spaceId, optionId: { in: optionIds } },
    _sum: { quantity: true },
  })
  const stockByOption = new Map<string, number>()
  for (const g of stockGroups) {
    stockByOption.set(g.optionId, g._sum.quantity ?? 0)
  }

  // ── 3) 분석 기간별 OUTBOUND 집계 ──────────────────────────────────────────
  const windowBuckets = new Map<number, string[]>()
  const optionProductMap = new Map<string, (typeof products)[0]>()
  for (const p of products) {
    const wd = p.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const list = windowBuckets.get(wd) ?? []
    list.push(...p.options.map((o) => o.id))
    windowBuckets.set(wd, list)
    for (const o of p.options) {
      optionProductMap.set(o.id, p)
    }
  }

  // windowDays별 일별 집계
  const dailyOutboundByOption = new Map<string, Record<string, number>>()
  const windowDaysByOption = new Map<string, number>()
  const now = new Date()

  for (const [wd, ids] of windowBuckets.entries()) {
    if (!ids.length) continue
    const since = new Date(now.getTime() - wd * 24 * 60 * 60 * 1000)

    const movements = await prisma.invMovement.findMany({
      where: {
        spaceId,
        optionId: { in: ids },
        type: 'OUTBOUND',
        movementDate: { gte: since },
      },
      select: { optionId: true, movementDate: true, quantity: true },
    })

    // 옵션별 일별 집계
    for (const mv of movements) {
      const dateKey = toDateStr(mv.movementDate)
      const byDate = dailyOutboundByOption.get(mv.optionId) ?? {}
      byDate[dateKey] = (byDate[dateKey] ?? 0) + mv.quantity
      dailyOutboundByOption.set(mv.optionId, byDate)
    }

    for (const id of ids) {
      windowDaysByOption.set(id, wd)
      if (!dailyOutboundByOption.has(id)) {
        dailyOutboundByOption.set(id, {})
      }
    }
  }

  // ── 4) 직전 FINALIZED 계획의 bias 로드 ───────────────────────────────────
  const lastFinalized = await prisma.reorderPlan.findFirst({
    where: { spaceId, status: 'FINALIZED' },
    orderBy: { finalizedAt: 'desc' },
    select: {
      accuracies: {
        select: { optionId: true, bias: true },
      },
    },
  })
  const biasByOption = new Map<string, number>()
  if (lastFinalized) {
    for (const acc of lastFinalized.accuracies) {
      biasByOption.set(acc.optionId, Number(acc.bias))
    }
  }

  // ── 5) 옵션별 예측 + 수량 계산 ────────────────────────────────────────────
  const itemInputs: Array<{
    productId: string
    optionId: string
    leadTimeDays: number
    safetyStockQty: number
    currentStock: number
    roundUnit: number
    forecastResult: ReturnType<typeof forecastOption>
    biasAdjustFactor: number
    suggestedQty: number
    roundedSuggestedQty: number
  }> = []

  for (const p of products) {
    const leadTimeDays = p.reorderConfig?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const roundUnit = p.reorderRoundUnit ?? 10

    for (const o of p.options) {
      const wd = windowDaysByOption.get(o.id) ?? DEFAULT_WINDOW_DAYS
      const outboundMap = dailyOutboundByOption.get(o.id) ?? {}
      const history = buildDailySeries(outboundMap, wd, now)
      const forecastResult = forecastOption({ history, leadTimeDays })

      const prevBias = biasByOption.get(o.id) ?? null
      const biasAdjustFactor = computeBiasAdjust(prevBias)

      const currentStock = stockByOption.get(o.id) ?? 0
      const safetyStockQty = o.safetyStockQty

      // suggestedQty = ceil((dailyAvg × bias) × leadTime + safety − currentStock)
      const rawQty =
        forecastResult.dailyAvg * biasAdjustFactor * leadTimeDays + safetyStockQty - currentStock
      const suggestedQty = Math.max(0, Math.ceil(rawQty))
      const roundedSuggestedQty = suggestedQty > 0 ? roundUp(suggestedQty, roundUnit) : 0

      itemInputs.push({
        productId: p.id,
        optionId: o.id,
        leadTimeDays,
        safetyStockQty,
        currentStock,
        roundUnit,
        forecastResult,
        biasAdjustFactor,
        suggestedQty,
        roundedSuggestedQty,
      })
    }
  }

  // ── 6) LLM rationale 생성 (concurrency 제한) ─────────────────────────────
  // 옵션 수가 많을 때 LLM 동시 호출이 rate limit을 유발하므로 5건씩 제한
  const rationaleResults = await mapWithConcurrency(itemInputs, LLM_CONCURRENCY, (item) =>
    generateRationale({
      model: item.forecastResult.model,
      dailyAvg: item.forecastResult.dailyAvg,
      leadTime: item.leadTimeDays,
      safetyStock: item.safetyStockQty,
      currentStock: item.currentStock,
      profile: String(item.forecastResult.debug.profile ?? ''),
    })
  )

  // ── 7) 트랜잭션 저장 (P2002 충돌 시 1회 재시도) ───────────────────────────
  async function createPlan(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
    const planNo = await generatePlanNo(spaceId, tx)
    const totalSuggestedQty = itemInputs.reduce((s, i) => s + i.roundedSuggestedQty, 0)
    const biasAdjustApplied: Record<string, number> = {}
    for (const item of itemInputs) {
      biasAdjustApplied[item.optionId] = item.biasAdjustFactor
    }

    const plan = await tx.reorderPlan.create({
      data: {
        spaceId,
        planNo,
        status: 'DRAFT',
        windowDays: DEFAULT_WINDOW_DAYS,
        createdById: userId,
        totalSuggestedQty,
        totalFinalQty: 0,
        memo: body.memo ?? null,
        biasAdjustApplied,
      },
    })

    // 아이템 별도 생성 (relation connect 방식으로 타입 안전하게)
    await tx.reorderPlanItem.createMany({
      data: itemInputs.map((item, idx) => ({
        planId: plan.id,
        optionId: item.optionId,
        productId: item.productId,
        currentStock: item.currentStock,
        dailyAvgForecast: item.forecastResult.dailyAvg,
        forecastModel: item.forecastResult.model,
        leadTimeDays: item.leadTimeDays,
        safetyStockQty: item.safetyStockQty,
        suggestedQty: item.suggestedQty,
        roundedSuggestedQty: item.roundedSuggestedQty,
        finalQty: item.roundedSuggestedQty,
        roundUnit: item.roundUnit,
        rationale: rationaleResults[idx],
        biasAdjustFactor: item.biasAdjustFactor,
        confidenceScore: item.forecastResult.confidence,
        inputsSnapshot: JSON.parse(
          JSON.stringify({
            profile: item.forecastResult.debug.profile ?? null,
            forecastDebug: item.forecastResult.debug,
            biasAdjustFactor: item.biasAdjustFactor,
            windowDays: windowDaysByOption.get(item.optionId) ?? DEFAULT_WINDOW_DAYS,
            leadTimeDays: item.leadTimeDays,
            safetyStockQty: item.safetyStockQty,
            currentStock: item.currentStock,
          })
        ),
      })),
    })

    return plan.id
  }

  let planId: string
  try {
    planId = await prisma.$transaction(createPlan)
  } catch (e: unknown) {
    // P2002: unique constraint violation → planNo 충돌 재시도
    const isPrismaError = typeof e === 'object' && e !== null && 'code' in e
    if (isPrismaError && (e as { code: string }).code === 'P2002') {
      try {
        planId = await prisma.$transaction(createPlan)
      } catch (e2) {
        console.error('[reorder/plan] planNo 충돌 재시도 실패:', e2)
        return errorResponse('발주 계획 생성에 실패했습니다 (planNo 충돌)', 409)
      }
    } else {
      console.error('[reorder/plan] 트랜잭션 실패:', e)
      return errorResponse('발주 계획 생성에 실패했습니다', 500)
    }
  }

  // 생성된 계획 조회
  const created = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      planNo: true,
      items: {
        select: {
          id: true,
          optionId: true,
          productId: true,
          forecastModel: true,
          dailyAvgForecast: true,
          suggestedQty: true,
          roundedSuggestedQty: true,
          finalQty: true,
          rationale: true,
          confidenceScore: true,
        },
      },
    },
  })

  if (!created) return errorResponse('발주 계획 조회 실패', 500)

  return NextResponse.json({
    planId: created.id,
    planNo: created.planNo,
    items: created.items.map((item) => ({
      ...item,
      dailyAvgForecast: Number(item.dailyAvgForecast),
      confidenceScore: item.confidenceScore ? Number(item.confidenceScore) : null,
    })),
  })
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
