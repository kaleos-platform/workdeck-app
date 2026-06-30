// POST /api/sh/inventory/reorder/plan
// DRAFT 발주 계획 생성
//
// 흐름:
//  1) 옵션별 history(주문수요 — loadOptionDemand) + currentStock + config + safetyStock + roundUnit 로드
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
import { mapWithConcurrency } from '@/lib/concurrency'
import { settleEligiblePlans } from '@/lib/inv/forecast/settle-accuracy'
import { generatePlanNo } from '@/lib/inv/reorder-seq'
import { loadOptionDemand } from '@/lib/inv/option-demand'
import { plannedStockQty, sumIncomingProductionQtyByOption } from '@/lib/inv/planned-stock'
import { decomposeSetsToOptions, suggestSetQty, computeSetAvailable } from '@/lib/sh/set-plan-calc'

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_LEAD_TIME_DAYS = 7

// planNo 생성은 @/lib/inv/reorder-seq 의 generatePlanNo 공유 (revert/generate-run 과 동일)

// LLM 동시 호출 상한 (rate limit 방어)
const LLM_CONCURRENCY = 5

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

  // 요청 바디 — 두 모드:
  //  (A) 상품 단위: { productId, optionIds? } — 기존 동작.
  //  (B) 연동 위치 세트: { locationId } — 연동 위치(예: 쿠팡 로켓그로스)의 대표 채널 세트(ProductListing,
  //      구성 2개+)를 구성옵션으로 분해해 발주 계획을 만든다. productId·locationId 동시 지정 금지.
  let body: { productId?: string; locationId?: string; memo?: string; optionIds?: string[] } = {}
  try {
    body = await req.json()
  } catch {
    // 파싱 실패 시 빈 바디 → 아래 검증에서 차단
  }

  if (!body.productId && !body.locationId) {
    return errorResponse('발주 계획은 상품 또는 연동 위치 단위로 생성합니다.', 422)
  }
  if (body.productId && body.locationId) {
    return errorResponse('상품과 연동 위치는 동시에 선택할 수 없습니다.', 422)
  }

  type PlanProduct = {
    id: string
    brandId: string | null
    reorderRoundUnit: number | null
    options: { id: string; safetyStockQty: number }[]
    reorderConfig: { leadTimeDays: number; analysisWindowDays: number } | null
  }
  // 세트 스펙 (연동 위치 모드에서만) — listing(=세트)별 구성(optionId×perSet)
  type SetSpec = {
    listingId: string
    listingName: string
    sortOrder: number
    items: { optionId: string; perSet: number }[]
  }

  let products: PlanProduct[] = []
  let setSpecs: SetSpec[] | null = null
  const planLocationId = body.locationId ?? null

  if (body.productId) {
    // ── (A) 상품 단위 ───────────────────────────────────────────────────────
    const selectedOptionIds =
      Array.isArray(body.optionIds) && body.optionIds.length > 0 ? body.optionIds : null

    products = await prisma.invProduct.findMany({
      where: { spaceId, status: 'ACTIVE', id: body.productId },
      select: {
        id: true,
        brandId: true,
        reorderRoundUnit: true,
        options: {
          ...(selectedOptionIds ? { where: { id: { in: selectedOptionIds } } } : {}),
          select: { id: true, safetyStockQty: true },
        },
        reorderConfig: { select: { leadTimeDays: true, analysisWindowDays: true } },
      },
    })

    if (products.length === 0) {
      return errorResponse('선택한 상품을 찾을 수 없습니다 (활성 상태가 아니거나 권한 없음)', 422)
    }
    if (selectedOptionIds && products.every((p) => p.options.length === 0)) {
      return errorResponse('선택된 옵션이 없습니다', 422)
    }
  } else {
    // ── (B) 연동 위치 세트 ──────────────────────────────────────────────────
    // 연동 위치 → externalSource 페어링 채널 → 대표 채널 → 세트(ProductListing, 구성 2개+)
    const location = await prisma.invStorageLocation.findFirst({
      where: { id: planLocationId!, spaceId },
      select: { id: true, externalSource: true },
    })
    if (!location || !location.externalSource) {
      return errorResponse('연동 위치를 찾을 수 없습니다 (externalSource 미설정)', 422)
    }
    const fulfillmentChannel = await prisma.channel.findFirst({
      where: { spaceId, externalSource: location.externalSource },
      select: { representativeChannelId: true },
    })
    const reprChannelId = fulfillmentChannel?.representativeChannelId
    if (!reprChannelId) {
      return errorResponse('연동 위치에 대표 채널이 연결되어 있지 않습니다.', 422)
    }
    const listings = await prisma.productListing.findMany({
      where: { spaceId, channelId: reprChannelId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        searchName: true,
        managementName: true,
        items: { select: { optionId: true, quantity: true }, orderBy: { sortOrder: 'asc' } },
      },
    })
    // 세트 = 구성 2개 이상 (단일 구성은 묶음 아님)
    const setListings = listings.filter((l) => l.items.length > 1)
    if (setListings.length === 0) {
      return errorResponse('이 연동 위치의 대표 채널에 세트 상품(구성 2개 이상)이 없습니다.', 422)
    }
    setSpecs = setListings.map((l, idx) => ({
      listingId: l.id,
      listingName: l.managementName?.trim() || l.searchName,
      sortOrder: idx,
      items: l.items.map((it) => ({ optionId: it.optionId, perSet: it.quantity })),
    }))

    // 구성옵션 union → 옵션을 product 단위로 그룹핑(예측 설정 로드)
    const compOptionIds = Array.from(
      new Set(setSpecs.flatMap((s) => s.items.map((i) => i.optionId)))
    )
    const options = await prisma.invProductOption.findMany({
      where: { id: { in: compOptionIds }, product: { spaceId } },
      select: {
        id: true,
        safetyStockQty: true,
        product: {
          select: {
            id: true,
            brandId: true,
            reorderRoundUnit: true,
            reorderConfig: { select: { leadTimeDays: true, analysisWindowDays: true } },
          },
        },
      },
    })
    const byProduct = new Map<string, PlanProduct>()
    for (const o of options) {
      const p = o.product
      let entry = byProduct.get(p.id)
      if (!entry) {
        entry = {
          id: p.id,
          brandId: p.brandId,
          reorderRoundUnit: p.reorderRoundUnit,
          options: [],
          reorderConfig: p.reorderConfig,
        }
        byProduct.set(p.id, entry)
      }
      entry.options.push({ id: o.id, safetyStockQty: o.safetyStockQty })
    }
    products = Array.from(byProduct.values())
    if (products.length === 0) {
      return errorResponse('세트 구성 옵션을 찾을 수 없습니다.', 422)
    }
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

  const pendingRuns = await prisma.productionRun.findMany({
    where: {
      spaceId,
      status: 'ORDERED',
      items: { some: { optionId: { in: optionIds } } },
    },
    select: {
      status: true,
      items: {
        where: { optionId: { in: optionIds } },
        select: { optionId: true, quantity: true },
      },
    },
  })
  const incomingByOption = sumIncomingProductionQtyByOption(pendingRuns)

  // ── 3) 분석 기간별 주문수요 집계 ──────────────────────────────────────────
  // 수요 신호 = 옵션×일자 주문수요(수동채널 DelOrderItem + 로켓 VENDOR). 판매분석과
  // 동일한 loadOptionDemand 를 공유해 두 화면이 정의상 같은 수요를 본다.
  // (OUTBOUND 장부 대신 주문수요 — OUTBOUND 는 재고차감 전용.)
  // accuracy.ts 의 WAPE/bias baseline 도 같은 loadOptionDemand 를 써 예측-검증이 정합한다
  //   (stockout/overstock 만 물리적 OUTBOUND 유지).
  const windowDaysByOption = new Map<string, number>()
  for (const p of products) {
    const wd = p.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    for (const o of p.options) {
      windowDaysByOption.set(o.id, wd)
    }
  }

  const now = new Date()

  // 활성 채널 전체(발주는 채널 무관 전수 수요). 최대 window 한 번 로드 후 옵션별로 자른다
  // (buildDailySeries 가 옵션별 windowDays 로 zero-fill·절단).
  const maxWindowDays = Math.max(DEFAULT_WINDOW_DAYS, ...windowDaysByOption.values())
  const since = new Date(now.getTime() - maxWindowDays * 24 * 60 * 60 * 1000)
  const optionIdSet = new Set(optionIds)

  const activeChannels = await prisma.channel.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true, externalSource: true },
  })

  const demandRows = await loadOptionDemand(spaceId, since, now, activeChannels)

  // 옵션별 일별 수요 집계 (채널 합산). 이 계획 스코프 옵션만.
  const dailyOutboundByOption = new Map<string, Record<string, number>>()
  for (const id of optionIds) dailyOutboundByOption.set(id, {})
  for (const row of demandRows) {
    if (!optionIdSet.has(row.optionId)) continue
    const byDate = dailyOutboundByOption.get(row.optionId)!
    byDate[row.date] = (byDate[row.date] ?? 0) + row.quantity
  }

  // ── 4) 직전 입고분 자동 정산(lazy) + 정산된 계획의 bias 로드 ──────────────
  // cron 대신 발주 계획 생성 시점에 입고 완료된 FINALIZED 계획을 즉시 정산한다.
  // 정산 실패는 무시하고 진행 → bias가 없으면 computeBiasAdjust(null)=1.0 폴백.
  try {
    await settleEligiblePlans(spaceId)
  } catch {
    // 정산 실패가 발주 계획 생성을 막지 않도록 무시
  }

  // ACTIVE accuracy가 채워진 가장 최근 확정 계획의 bias를 사용.
  // validity=ACTIVE만 — revert로 SUPERSEDED/INVALIDATED된 측정값은 학습에서 제외.
  const lastSettled = await prisma.reorderPlan.findFirst({
    where: { spaceId, accuracies: { some: { validity: 'ACTIVE' } } },
    orderBy: { confirmedAt: 'desc' },
    select: {
      id: true,
      accuracies: {
        where: { validity: 'ACTIVE' },
        select: { optionId: true, bias: true },
      },
    },
  })
  // provenance — 이 계획 예측에 입력된 bias의 출처(어느 정산 계획). 새 계획의 accuracy
  // settle 시점에 ReorderPlanAccuracy.biasSourcePlanId로 기록됨(향후 settle 경로에서 연결).
  const biasByOption = new Map<string, number>()
  if (lastSettled) {
    for (const acc of lastSettled.accuracies) {
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
    onHandStock: number
    incomingQty: number
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

      const onHandStock = stockByOption.get(o.id) ?? 0
      const incomingQty = incomingByOption.get(o.id) ?? 0
      const currentStock = plannedStockQty({ onHandQty: onHandStock, incomingQty })
      const safetyStockQty = o.safetyStockQty

      // suggestedQty = ceil((dailyAvg × bias) × leadTime + safety − 계획기준재고)
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
        onHandStock,
        incomingQty,
        roundUnit,
        forecastResult,
        biasAdjustFactor,
        suggestedQty,
        roundedSuggestedQty,
      })
    }
  }

  // ── 5.5) 세트 모드: 옵션 제안량 → 세트 제안량(병목) → finalSetQty 분해 → 옵션 finalQty 재정의 ──
  // 옵션별 forecast suggestedQty(순발주 필요량)를 병목으로 묶어 세트 제안수량을 만들고,
  // finalSetQty(기본=제안)를 다시 옵션으로 분해해 옵션 finalQty 를 세트-정합하게 맞춘다.
  let planSetsData: Array<{
    listingId: string
    listingName: string
    currentSetStock: number
    suggestedSetQty: number
    finalSetQty: number
    sortOrder: number
  }> | null = null
  let optionFinalQtyOverride: Map<string, number> | null = null
  if (setSpecs) {
    const suggestedByOption = new Map<string, number>()
    const onHandByOption = new Map<string, number>()
    for (const it of itemInputs) {
      suggestedByOption.set(it.optionId, it.suggestedQty)
      onHandByOption.set(it.optionId, it.onHandStock)
    }
    planSetsData = setSpecs.map((s) => {
      const suggestedSetQty = suggestSetQty(s.items, suggestedByOption)
      const currentSetStock = computeSetAvailable(s.items, onHandByOption)
      return {
        listingId: s.listingId,
        listingName: s.listingName,
        currentSetStock,
        suggestedSetQty,
        finalSetQty: suggestedSetQty,
        sortOrder: s.sortOrder,
      }
    })
    optionFinalQtyOverride = decomposeSetsToOptions(
      setSpecs.map((s) => ({
        listingId: s.listingId,
        setQty: planSetsData!.find((p) => p.listingId === s.listingId)!.finalSetQty,
        items: s.items,
      }))
    )
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

    // 세트 모드: finalQty = 분해값 → totalFinalQty 도 의미값. 상품 모드: 기존대로 0(편집 시 갱신).
    const totalFinalQty = optionFinalQtyOverride
      ? itemInputs.reduce((s, i) => s + (optionFinalQtyOverride!.get(i.optionId) ?? 0), 0)
      : 0

    const plan = await tx.reorderPlan.create({
      data: {
        spaceId,
        planNo,
        productId: body.productId ?? null,
        locationId: planLocationId,
        status: 'DRAFT',
        windowDays: DEFAULT_WINDOW_DAYS,
        createdById: userId,
        totalSuggestedQty,
        totalFinalQty,
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
        // 세트 모드: 옵션 finalQty = 세트 분해값(세트-정합). 상품 모드: 기존 forecast 제안값.
        finalQty: optionFinalQtyOverride
          ? (optionFinalQtyOverride.get(item.optionId) ?? 0)
          : item.roundedSuggestedQty,
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
            onHandStock: item.onHandStock,
            incomingQty: item.incomingQty,
          })
        ),
      })),
    })

    // 세트 모드: 세트별 라인 저장 (옵션 items 는 위에서 분해 저장됨)
    if (planSetsData) {
      await tx.reorderPlanSet.createMany({
        data: planSetsData.map((s) => ({
          planId: plan.id,
          listingId: s.listingId,
          listingName: s.listingName,
          currentSetStock: s.currentSetStock,
          suggestedSetQty: s.suggestedSetQty,
          finalSetQty: s.finalSetQty,
          sortOrder: s.sortOrder,
        })),
      })
    }

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
      locationId: true,
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
      sets: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          listingId: true,
          listingName: true,
          currentSetStock: true,
          suggestedSetQty: true,
          finalSetQty: true,
        },
      },
    },
  })

  if (!created) return errorResponse('발주 계획 조회 실패', 500)

  return NextResponse.json({
    planId: created.id,
    planNo: created.planNo,
    locationId: created.locationId,
    items: created.items.map((item) => ({
      ...item,
      dailyAvgForecast: Number(item.dailyAvgForecast),
      confidenceScore: item.confidenceScore ? Number(item.confidenceScore) : null,
    })),
    sets: created.sets,
  })
}
