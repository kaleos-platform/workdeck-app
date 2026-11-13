// POST /api/sh/inventory/reorder/plan
// DRAFT 발주 계획 생성
//
// 흐름:
//  1) config 로드 + 입고 완료 계획 정산(settleEligiblePlans)
//  2) loadPlanOptionInputs — 주문수요·재고·품절일·직전 정산 bias·모델 실적 (MCP 발주 액션과 공용)
//  3) computeProductPlan — 품절일 제외 시계열 → 모델 비교·백테스트 추천·상품 단위 선택
//     → 발주량 = 일률 × (리드타임 + 목표 커버일수) + 안전재고 − 현재고 − 입고 예정
//  4) LLM rationale 생성 (실패 시 결정론적 폴백 텍스트)
//  5) ReorderPlan + ReorderPlanItem 트랜잭션 저장
//  6) { planId, items } 응답

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateTextForSpace } from '@/lib/ai/resolve'
import { mapWithConcurrency } from '@/lib/concurrency'
import { settleEligiblePlans } from '@/lib/inv/forecast/settle-accuracy'
import { generatePlanNo } from '@/lib/inv/reorder-seq'
import { DEFAULT_PRODUCTION_LEAD_TIME_DAYS as DEFAULT_LEAD_TIME_DAYS } from '@/lib/inv/reorder-calculator'
import { plannedStockQty } from '@/lib/inv/planned-stock'
import { computeSetAvailable } from '@/lib/sh/set-plan-calc'
import {
  computeProductPlan,
  isModelKey,
  loadPlanOptionInputs,
  type PlanOptionResult,
  type SelectedModel,
} from '@/lib/inv/reorder-engine'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

const DEFAULT_WINDOW_DAYS = 90
const DEFAULT_TARGET_COVER_DAYS = 30

// planNo 생성은 @/lib/inv/reorder-seq 의 generatePlanNo 공유 (revert/generate-run 과 동일)

// LLM 동시 호출 상한 (rate limit 방어)
const LLM_CONCURRENCY = 5

// ─── LLM rationale 생성 ────────────────────────────────────────────────────────

async function generateRationale(params: {
  spaceId: string
  model: string
  dailyAvg: number
  leadTime: number
  safetyStock: number
  currentStock: number
  profile: string
}): Promise<string> {
  const { spaceId, model, dailyAvg, leadTime, safetyStock, currentStock, profile } = params

  // 결정론적 폴백 텍스트 (LLM 호출 전 기본값)
  const fallback = `${model} 모델(${profile}) 기반 일평균 ${dailyAvg.toFixed(2)}개 예측, 리드타임 ${leadTime}일 + 안전재고 ${safetyStock}개 적용 (현재재고 ${currentStock}개).`

  try {
    const { result } = await generateTextForSpace(spaceId, {
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
  const resolved = await resolveDeckContext('seller-hub', { write: true })
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const userId = resolved.user.id

  // 요청 바디 — 두 모드:
  //  (A) 상품 단위: { productId, optionIds? } — 기존 동작.
  //  (B) 연동 위치 세트: { locationId } — 연동 위치(예: 쿠팡 로켓그로스)의 대표 채널 세트(ProductListing,
  //      구성 2개+)를 구성옵션으로 분해해 발주 계획을 만든다. productId·locationId 동시 지정 금지.
  // 생성 위저드용 확장(상품 모드 전용):
  //  - dryRun: persist 없이 계산 결과만 반환(미리보기). 실제 생성과 동일 코드 경로라 drift 없음.
  //  - excludeRocketLayer: 적격 상품이라도 레이어드 감지 skip → 평이 상품 플랜 강제.
  //  - optionFinalOverrides: 옵션별 최종수량 수동 지정(위저드 편집). baseline floor 적용 후 반영.
  let body: {
    productId?: string
    locationId?: string
    memo?: string
    optionIds?: string[]
    dryRun?: boolean
    excludeRocketLayer?: boolean
    optionFinalOverrides?: Record<string, number>
    linkedLocationIds?: string[]
    leadTimeDaysOverride?: number
    demandAdjustFactorOverride?: number
    modelByProduct?: Record<string, unknown>
    manualQtyByOption?: Record<string, unknown>
  } = {}
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

  const leadTimeDaysOverride =
    typeof body.leadTimeDaysOverride === 'number' && Number.isFinite(body.leadTimeDaysOverride)
      ? Math.floor(body.leadTimeDaysOverride)
      : null
  if (leadTimeDaysOverride !== null && (leadTimeDaysOverride < 1 || leadTimeDaysOverride > 365)) {
    return errorResponse('리드타임은 1~365일 사이로 입력하세요.', 422)
  }

  const demandAdjustFactorOverride =
    typeof body.demandAdjustFactorOverride === 'number' &&
    Number.isFinite(body.demandAdjustFactorOverride)
      ? body.demandAdjustFactorOverride
      : null
  if (
    demandAdjustFactorOverride !== null &&
    (demandAdjustFactorOverride <= 0 || demandAdjustFactorOverride > 10)
  ) {
    return errorResponse('보정계수는 0보다 크고 10 이하로 입력하세요.', 422)
  }

  // 상품별 모델 지정(MANUAL 포함) — 유효 키만 통과
  // 'AUTO' = 고정 해제(설정 모델 무시, 추천 사용)
  const modelByProduct = new Map<string, SelectedModel | 'AUTO'>()
  for (const [pid, m] of Object.entries(body.modelByProduct ?? {})) {
    if (isModelKey(m) || m === 'MANUAL' || m === 'AUTO') modelByProduct.set(pid, m)
  }
  // 신상품 옵션 수동 수량 — 0 이상 유한수만
  const manualQtyByOption: Record<string, number> = {}
  for (const [oid, q] of Object.entries(body.manualQtyByOption ?? {})) {
    if (typeof q === 'number' && Number.isFinite(q) && q >= 0)
      manualQtyByOption[oid] = Math.floor(q)
  }

  const reorderConfigSelect = {
    leadTimeDays: true,
    analysisWindowDays: true,
    targetCoverDays: true,
    excludeFromForecast: true,
    forecastModel: true,
  } as const
  type PlanProduct = {
    id: string
    brandId: string | null
    reorderRoundUnit: number | null
    options: { id: string; safetyStockQty: number; createdAt: Date }[]
    reorderConfig: {
      leadTimeDays: number
      analysisWindowDays: number
      targetCoverDays: number
      excludeFromForecast: boolean
      forecastModel: string | null
    } | null
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
  // 레이어드(상품 모드 + 로켓 연동 위치) 전용 — 로켓 채널 id(수요 분할 키). null = 비레이어드.
  let rocketChannelId: string | null = null
  let rocketLocationId: string | null = null
  const linkedLocationIdsForCalc: string[] = []

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
          // 삭제·단종 옵션은 생산·발주 대상이 아니다
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            ...(selectedOptionIds ? { id: { in: selectedOptionIds } } : {}),
          },
          select: { id: true, safetyStockQty: true, createdAt: true },
        },
        reorderConfig: { select: reorderConfigSelect },
      },
    })

    if (products.length === 0) {
      return errorResponse('선택한 상품을 찾을 수 없습니다 (활성 상태가 아니거나 권한 없음)', 422)
    }
    products = products.filter((p) => !p.reorderConfig?.excludeFromForecast)
    if (products.length === 0) {
      return errorResponse('발주 예측에서 제외된 상품입니다. 발주 설정에서 제외를 해제하세요.', 422)
    }
    // 옵션이 전부 삭제·단종이면 빈 계획이 만들어진다 — 선택 여부와 무관하게 막는다
    if (products.every((p) => p.options.length === 0)) {
      return errorResponse('발주할 옵션이 없습니다 (선택 옵션이 없거나 모두 단종)', 422)
    }

    // ── 레이어드 탐지 — 자동 감지 + 사용자가 고른 다수 연동 위치 직접 탐색 ──
    // 1순위: 사용자가 linkedLocationIds로 고른 연동 위치들.
    // 2순위: 로켓그로스 기본 연동 위치.
    // 매칭 기준은 InvLocationProductMap 또는 해당 위치의 InvStockLevel(이미 재고에 있는 내부 옵션)이다.
    const productOptionIds = new Set(products.flatMap((p) => p.options.map((o) => o.id)))
    const requestedLocationIds = Array.isArray(body.linkedLocationIds)
      ? body.linkedLocationIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    const candidateLocations = body.excludeRocketLayer
      ? []
      : await prisma.invStorageLocation.findMany({
          where:
            requestedLocationIds.length > 0
              ? {
                  spaceId,
                  id: { in: requestedLocationIds },
                  isActive: true,
                  externalSource: { not: null },
                }
              : {
                  spaceId,
                  externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
                  isActive: true,
                },
          select: { id: true, externalSource: true },
          orderBy: { createdAt: 'asc' },
        })

    for (const loc of candidateLocations) {
      if (!loc.externalSource) continue
      const [mapped, stocked] = await Promise.all([
        prisma.invLocationProductMap.findFirst({
          where: {
            spaceId,
            locationId: loc.id,
            items: { some: { optionId: { in: Array.from(productOptionIds) } } },
          },
          select: { id: true },
        }),
        prisma.invStockLevel.findFirst({
          where: { spaceId, locationId: loc.id, optionId: { in: Array.from(productOptionIds) } },
          select: { id: true },
        }),
      ])
      if (!mapped && !stocked) continue

      linkedLocationIdsForCalc.push(loc.id)
      if (!rocketLocationId) {
        rocketLocationId = loc.id
        const linkedChannel = await prisma.channel.findFirst({
          where: { spaceId, externalSource: loc.externalSource, isActive: true },
          select: { id: true, representativeChannelId: true },
        })
        rocketChannelId = linkedChannel?.id ?? null

        if (linkedChannel?.representativeChannelId) {
          const listings = await prisma.productListing.findMany({
            where: { spaceId, channelId: linkedChannel.representativeChannelId, status: 'ACTIVE' },
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              searchName: true,
              managementName: true,
              items: { select: { optionId: true, quantity: true }, orderBy: { sortOrder: 'asc' } },
            },
          })
          const qualifying = listings.filter(
            (l) => l.items.length > 0 && l.items.every((it) => productOptionIds.has(it.optionId))
          )
          if (qualifying.length > 0) {
            setSpecs = qualifying.map((l, idx) => ({
              listingId: l.id,
              listingName: l.managementName?.trim() || l.searchName,
              sortOrder: idx,
              items: l.items.map((it) => ({ optionId: it.optionId, perSet: it.quantity })),
            }))
          }
        }
      }
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
      // 세트 구성 중 삭제·단종 옵션은 생산 대상에서 뺀다
      where: { id: { in: compOptionIds }, product: { spaceId }, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        safetyStockQty: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            brandId: true,
            reorderRoundUnit: true,
            reorderConfig: { select: reorderConfigSelect },
          },
        },
      },
    })
    const byProduct = new Map<string, PlanProduct>()
    for (const o of options) {
      const p = o.product
      // 발주 예측 제외 상품의 구성옵션은 생산 대상에서 뺀다
      if (p.reorderConfig?.excludeFromForecast) continue
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
      entry.options.push({ id: o.id, safetyStockQty: o.safetyStockQty, createdAt: o.createdAt })
    }
    products = Array.from(byProduct.values())
    if (products.length === 0) {
      return errorResponse('세트 구성 옵션을 찾을 수 없습니다.', 422)
    }
  }

  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))

  // 레이어드 = 상품 모드(planLocationId 없음)인데 로켓그로스 연동 위치/채널이 감지됨.
  // 세트 환산표(setSpecs)는 있으면 표시용으로만 저장하고, 없더라도 로켓/직접 수요 분리는 수행한다.
  const isLayered = rocketChannelId != null && planLocationId == null

  const now = new Date()

  // ── 2) 직전 입고분 자동 정산(lazy) ──────────────────────────────────────
  // cron 대신 발주 계획 생성 시점에 입고 완료된 FINALIZED 계획을 즉시 정산한다(bias 로드 전).
  // 정산 실패는 무시하고 진행 → bias가 없으면 computeBiasAdjust(null)=1.0 폴백.
  // dryRun(미리보기)은 write side-effect 금지 — 위저드가 상품선택·토글마다 호출하므로 settle 반복 write 방지.
  if (!body.dryRun) {
    try {
      await settleEligiblePlans(spaceId)
    } catch {
      // 정산 실패가 발주 계획 생성을 막지 않도록 무시
    }
  }

  // ── 3) 입력 로드 — 재고·주문수요·품절일·bias·모델 실적 (MCP 발주 액션과 공용) ──
  // 레이어드 연동 위치 = 사용자가 고른 연동 위치 전체(로켓그로스 외 외부 위치 포함) →
  // rocketOnHandQty·rocketIncomingQty 가 이 위치 기준.
  const { stockInputs, optionInputsByProduct, realizedByProduct, windowDaysByOption } =
    await loadPlanOptionInputs({
      spaceId,
      products,
      now,
      linkedLocationIds: linkedLocationIdsForCalc.length > 0 ? linkedLocationIdsForCalc : undefined,
      rocketChannelId: isLayered ? rocketChannelId : null,
      demandAdjustFactor: demandAdjustFactorOverride ?? 1,
    })

  // ── 4) 상품 단위 예측 + 수량 계산 (computeProductPlan) ──────────────────────
  const itemInputs: Array<{
    productId: string
    optionId: string
    leadTimeDays: number
    analysisWindowDays: number
    safetyStockQty: number
    currentStock: number
    onHandStock: number
    /** 발주 계산에서 제외된 반품 등급 재고(표시용). 0이면 필드 없음 */
    returnQty?: number
    incomingQty: number
    roundUnit: number
    biasAdjustFactor: number
    suggestedQty: number
    roundedSuggestedQty: number
    plan: PlanOptionResult
  }> = []

  for (const p of products) {
    const leadTimeDays =
      leadTimeDaysOverride ?? p.reorderConfig?.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS
    const roundUnit = p.reorderRoundUnit ?? 10
    const windowDays = p.reorderConfig?.analysisWindowDays ?? DEFAULT_WINDOW_DAYS
    const targetCoverDays = p.reorderConfig?.targetCoverDays ?? DEFAULT_TARGET_COVER_DAYS
    const storedModel = p.reorderConfig?.forecastModel
    const modelChoice = modelByProduct.get(p.id)
    const configModel = modelChoice !== 'AUTO' && isModelKey(storedModel) ? storedModel : null

    const optionInputs = optionInputsByProduct.get(p.id) ?? []

    const results = computeProductPlan({
      options: optionInputs,
      product: {
        leadTimeDays,
        targetCoverDays,
        roundUnit,
        windowDays,
        configModel,
        overrideModel: modelChoice === 'AUTO' ? undefined : modelChoice,
        realized: realizedByProduct.get(p.id),
        layered: isLayered,
      },
      manualQtyByOption,
      now,
    })

    results.forEach((plan, idx) => {
      const input = optionInputs[idx]
      itemInputs.push({
        productId: p.id,
        optionId: plan.optionId,
        leadTimeDays,
        analysisWindowDays: windowDays,
        safetyStockQty: input.safetyStockQty,
        currentStock: plannedStockQty({
          onHandQty: input.stock.onHandQty,
          incomingQty: input.stock.incomingQty,
        }),
        onHandStock: input.stock.onHandQty,
        returnQty: input.stock.returnGradeQty > 0 ? input.stock.returnGradeQty : undefined,
        incomingQty: input.stock.incomingQty,
        roundUnit,
        biasAdjustFactor: input.biasFactor,
        suggestedQty: plan.suggestedQty,
        roundedSuggestedQty: plan.roundedSuggestedQty,
        plan,
      })
    })
  }

  // ── 5.5) 세트 모드: 옵션 수요가 진실, 세트는 옵션 발주수량의 역산 표시(파생) ──
  // 위치·레이어드 공통 — 옵션 자체 수요를 최종수량으로 쓰고, 세트는 그로 구성 가능한 완성
  // 세트 수(min floor = computeSetAvailable)를 읽기전용으로 역산해 보여준다. 세트를 개별
  // 리스팅마다 옵션 전량 커버로 사이징해 합산하면 중복/부분겹침 세트의 공유 옵션이 ×N 과다집계됨.
  let planSetsData: Array<{
    listingId: string
    listingName: string
    currentSetStock: number
    suggestedSetQty: number
    finalSetQty: number
    sortOrder: number
  }> | null = null
  let optionFinalQtyOverride: Map<string, number> | null = null
  // 레이어드 전용 — 레이어별 raw GROSS(컬럼 저장 + 응답 분해 표시용).
  let directGrossByOption: Map<string, number> | null = null
  let rocketGrossByOption: Map<string, number> | null = null
  let rocketNeedByOption: Map<string, number> | null = null
  let rocketExpectedSalesByOption: Map<string, number> | null = null
  let rocketSafetyStockByOption: Map<string, number> | null = null

  // 세트 라인 = 옵션 발주수량의 역산(참고 표시, 읽기전용). 완성 세트 = min floor(finalQty/perSet).
  // 위치·레이어드 두 세트 모드 공통 — 세트를 되먹여 사이징하지 않으므로 공유 옵션 ×N 과다집계 없음.
  const buildReadOnlySetLines = (
    finalByOption: Map<string, number>,
    onHandByOption: Map<string, number>
  ) =>
    setSpecs!.map((s) => {
      const backDerivedSetQty = computeSetAvailable(s.items, finalByOption)
      const currentSetStock = computeSetAvailable(s.items, onHandByOption)
      return {
        listingId: s.listingId,
        listingName: s.listingName,
        currentSetStock,
        suggestedSetQty: backDerivedSetQty,
        finalSetQty: backDerivedSetQty,
        sortOrder: s.sortOrder,
      }
    })

  if (setSpecs && !isLayered) {
    // ── 위치 세트 모드 (옵션 중심 통일) — 옵션 자체 net 수요가 진실. 세트는 읽기전용 역산 표시. ──
    // 로켓그로스 판매 granularity 는 옵션(단품) 단위(InvLocationProductMap 대부분 단일옵션)라
    // loadOptionDemand 옵션 집계수요가 곧 진짜 생산 필요량이다. 구현은 각 세트 리스팅을 옵션 전량
    // 커버로 suggestSetQty 사이징 후 decomposeSetsToOptions 합산해 공유 옵션을 ×N 과다집계했다
    // (실증 캡나시 화이트/M 78→273). → 옵션 finalQty = 옵션 자체 net 수요(roundedSuggestedQty,
    // 상품 모드와 동일·단일 차감). 세트는 옵션 발주수량의 역산(min floor)일 뿐 되먹이지 않는다.
    const onHandByOption = new Map<string, number>()
    optionFinalQtyOverride = new Map<string, number>()
    for (const it of itemInputs) {
      onHandByOption.set(it.optionId, Math.max(0, it.onHandStock)) // 세트 역산은 음수 재고를 0으로
      optionFinalQtyOverride.set(it.optionId, it.roundedSuggestedQty)
    }

    planSetsData = buildReadOnlySetLines(optionFinalQtyOverride, onHandByOption)
  } else if (isLayered) {
    // ── 레이어드 (상품 + 로켓그로스 연동 위치) — 옵션 수요가 진실. ──
    // 로켓 GROSS = 커버 기간 GROSS × 창 내 로켓 판매 비중. 전체 수량은 합산 후 반올림하고,
    // 반올림된 최종수량을 로켓그로스 위치 입고 필요분과 나머지로 분배한다(computeProductPlan 내부).
    const onHandByOption = new Map<string, number>()
    optionFinalQtyOverride = new Map<string, number>()
    directGrossByOption = new Map<string, number>()
    rocketGrossByOption = new Map<string, number>()
    rocketNeedByOption = new Map<string, number>()
    rocketExpectedSalesByOption = new Map<string, number>()
    rocketSafetyStockByOption = new Map<string, number>()
    for (const it of itemInputs) {
      const l = it.plan.layered!
      onHandByOption.set(it.optionId, Math.max(0, it.onHandStock)) // 세트 역산은 음수 재고를 0으로
      optionFinalQtyOverride.set(it.optionId, it.plan.finalQty)
      rocketExpectedSalesByOption.set(it.optionId, l.rocketExpectedSales)
      rocketSafetyStockByOption.set(it.optionId, l.rocketSafetyStock)
      rocketNeedByOption.set(it.optionId, l.linkedLocationNeedQty)
      // 기존 컬럼명을 유지하되 의미는 입고 분배 baseline/remaining 이다.
      // stockin-split·상세 UI가 이 값을 사용해 로켓그로스 입고분과 나머지를 구분한다.
      rocketGrossByOption.set(it.optionId, l.linkedLocationQty)
      directGrossByOption.set(it.optionId, l.remainingQty)
    }

    planSetsData = setSpecs ? buildReadOnlySetLines(optionFinalQtyOverride, onHandByOption) : null
  }

  // ── 5.6) 위저드 편집분(optionFinalOverrides) 반영 — 세트 역산·totalFinalQty·persist 정합 ──
  // 옵션별 최종수량 수동 지정(≥0). override 없는 옵션은 기존 계산값 유지.
  // 강제 floor(최종≥baseline) 없음 — 레이어드 최종은 연동 위치 부족분과 나머지 위치 부족분을
  // 분리 계산해 합산한다. 일반 위치 재고가 로켓그로스 부족분을 상쇄하면 안 된다.
  if (body.optionFinalOverrides) {
    if (!optionFinalQtyOverride) optionFinalQtyOverride = new Map<string, number>()
    for (const it of itemInputs) {
      const ov = body.optionFinalOverrides[it.optionId]
      if (ov == null) {
        if (!optionFinalQtyOverride.has(it.optionId)) {
          optionFinalQtyOverride.set(it.optionId, it.roundedSuggestedQty)
        }
        continue
      }
      optionFinalQtyOverride.set(it.optionId, Math.max(0, Math.floor(ov)))
    }
    // 세트 역산(planSetsData)을 override된 최종수량으로 재계산 (표시 정합)
    if (setSpecs) {
      const onHandByOption = new Map<string, number>()
      for (const it of itemInputs) onHandByOption.set(it.optionId, Math.max(0, it.onHandStock)) // 세트 역산은 음수 재고를 0으로
      planSetsData = buildReadOnlySetLines(optionFinalQtyOverride, onHandByOption)
    }
  }

  // 응답 item 공통 — 모델 비교·추천·선택 (위저드 표시용)
  const engineFields = (plan: PlanOptionResult) => ({
    models: plan.models,
    backtestWape: plan.backtestWape,
    recommendedModel: plan.recommendedModel,
    selectedModel: plan.selectedModel,
    targetCoverDays: plan.targetCoverDays,
    checkStock: plan.checkStock,
    isNewOption: plan.isNewOption,
    siblingAvgRate: plan.siblingAvgRate,
  })

  // ── 5.7) dryRun 미리보기 — persist·LLM 없이 계산 결과만 반환(생성 위저드 시드) ──
  // 실제 생성과 동일 코드 경로(수요·예측·레이어드 산식)라 미리보기 == 생성 플랜 by construction.
  if (body.dryRun) {
    const optMeta = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId } },
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        product: { select: { name: true } },
      },
    })
    const metaById = new Map(optMeta.map((o) => [o.id, o]))
    let locationName: string | null = null
    if (isLayered || setSpecs != null) {
      const rocketLoc = await prisma.invStorageLocation.findFirst({
        where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH, isActive: true },
        select: { name: true },
      })
      locationName = rocketLoc?.name ?? '로켓그로스'
    }
    return NextResponse.json({
      dryRun: true,
      isLayered,
      qualifies: isLayered || setSpecs != null,
      locationName,
      options: itemInputs.map((it) => {
        const m = metaById.get(it.optionId)
        return {
          optionId: it.optionId,
          productId: it.productId,
          optionName: m?.name ?? '',
          sku: m?.sku ?? null,
          productName: m?.product?.name ?? '',
          // 발주 금액 KPI용 옵션 원가. 미설정이면 null → 금액 표시 생략.
          costPrice: m?.costPrice != null ? Number(m.costPrice) : null,
          currentStock: it.currentStock,
          onHandStock: it.onHandStock,
          returnQty: it.returnQty,
          incomingQty: it.incomingQty,
          safetyStockQty: it.safetyStockQty,
          dailyAvgForecast: it.plan.dailyRate,
          forecastModel: it.plan.selectedModel,
          leadTimeDays: it.leadTimeDays,
          analysisWindowDays: it.analysisWindowDays,
          suggestedQty: it.suggestedQty,
          roundedSuggestedQty: it.roundedSuggestedQty,
          // 연동 위치: 옵션별 입고 필요 수량 + 계산 구성값. 비연동 = null.
          rocketBaselineQty: rocketGrossByOption
            ? Math.ceil(rocketGrossByOption.get(it.optionId) ?? 0)
            : null,
          directGrossQty: directGrossByOption ? (directGrossByOption.get(it.optionId) ?? 0) : null,
          linkedLocationExpectedSalesQty: rocketExpectedSalesByOption
            ? Math.ceil(rocketExpectedSalesByOption.get(it.optionId) ?? 0)
            : null,
          linkedLocationSafetyStockQty: rocketSafetyStockByOption
            ? Math.ceil(rocketSafetyStockByOption.get(it.optionId) ?? 0)
            : null,
          linkedLocationNeedQty: rocketNeedByOption
            ? Math.ceil(rocketNeedByOption.get(it.optionId) ?? 0)
            : null,
          linkedLocationCurrentStockQty: rocketGrossByOption
            ? (stockInputs.get(it.optionId)?.rocketOnHandQty ?? 0)
            : null,
          linkedLocationIncomingQty: rocketGrossByOption
            ? (stockInputs.get(it.optionId)?.rocketIncomingQty ?? 0)
            : null,
          finalQty: optionFinalQtyOverride
            ? (optionFinalQtyOverride.get(it.optionId) ?? 0)
            : it.roundedSuggestedQty,
          ...engineFields(it.plan),
        }
      }),
      sets: (planSetsData ?? []).map((s) => ({
        listingId: s.listingId,
        listingName: s.listingName,
        currentSetStock: s.currentSetStock,
        finalSetQty: s.finalSetQty,
        items: setSpecs?.find((ss) => ss.listingId === s.listingId)?.items ?? [],
      })),
    })
  }

  // ── 6) LLM rationale 생성 (concurrency 제한) ─────────────────────────────
  // 옵션 수가 많을 때 LLM 동시 호출이 rate limit을 유발하므로 5건씩 제한
  const rationaleResults = await mapWithConcurrency(itemInputs, LLM_CONCURRENCY, (item) =>
    generateRationale({
      spaceId,
      model: item.plan.selectedModel,
      dailyAvg: item.plan.dailyRate,
      leadTime: item.leadTimeDays,
      safetyStock: item.safetyStockQty,
      currentStock: item.currentStock,
      profile: `커버 ${item.plan.targetCoverDays}일`,
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
        dailyAvgForecast: item.plan.dailyRate,
        forecastModel: item.plan.selectedModel,
        modelForecasts: item.plan.modelForecasts,
        leadTimeDays: item.leadTimeDays,
        safetyStockQty: item.safetyStockQty,
        suggestedQty: item.suggestedQty,
        roundedSuggestedQty: item.roundedSuggestedQty,
        // 세트/레이어드 모드: 옵션 finalQty = override(분해·합산값). 상품 모드: 기존 forecast 제안값.
        finalQty: optionFinalQtyOverride
          ? (optionFinalQtyOverride.get(item.optionId) ?? 0)
          : item.roundedSuggestedQty,
        // 레이어드: 로켓/직접 raw GROSS 보관(분해 표시 + 옵션 수정 시 참조). 비레이어드 = null.
        rocketGrossQty: rocketGrossByOption?.get(item.optionId) ?? null,
        directGrossQty: directGrossByOption?.get(item.optionId) ?? null,
        roundUnit: item.roundUnit,
        rationale: rationaleResults[idx],
        biasAdjustFactor: item.biasAdjustFactor,
        confidenceScore: null,
        inputsSnapshot: JSON.parse(
          JSON.stringify({
            selectedModel: item.plan.selectedModel,
            recommendedModel: item.plan.recommendedModel,
            targetCoverDays: item.plan.targetCoverDays,
            isNewOption: item.plan.isNewOption,
            biasAdjustFactor: item.biasAdjustFactor,
            userDemandAdjustFactor: demandAdjustFactorOverride ?? 1,
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

    // 선택 모델을 상품 발주 설정에 고정(다음 계획 기본값). 설정 행이 없으면 기본값으로 만든다 —
    // 스키마 기본 리드타임(7)이 아니라 라우트 기본값(20)을 넣어 리드타임이 바뀌지 않게 한다.
    // 사용자가 modelByProduct 로 직접 고른 모델만 고정한다(추천·기존 설정값은 저장하지 않음 → 추천이 계속 갱신).
    // 'AUTO' 이거나 추천 모델과 같은 선택이면 고정 해제(forecastModel = null).
    const planProductIds = new Set(products.map((p) => p.id))
    for (const [productId, choice] of modelByProduct) {
      if (choice === 'MANUAL' || !planProductIds.has(productId)) continue
      const recommended = itemInputs.find((it) => it.productId === productId)?.plan.recommendedModel
      if (choice === 'AUTO' || choice === recommended) {
        await tx.invReorderConfig.updateMany({
          where: { productId },
          data: { forecastModel: null },
        })
        continue
      }
      await tx.invReorderConfig.upsert({
        where: { productId },
        update: { forecastModel: choice },
        create: { productId, forecastModel: choice, leadTimeDays: DEFAULT_LEAD_TIME_DAYS },
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
  const planByOption = new Map(itemInputs.map((it) => [it.optionId, it]))

  return NextResponse.json({
    planId: created.id,
    planNo: created.planNo,
    locationId: created.locationId,
    isLayered,
    items: created.items.map((item) => ({
      ...item,
      dailyAvgForecast: Number(item.dailyAvgForecast),
      confidenceScore: item.confidenceScore ? Number(item.confidenceScore) : null,
      // 레이어드 분해 표시용 (비레이어드 = null) — 로켓/직접 raw GROSS
      rocketGross: rocketGrossByOption?.get(item.optionId) ?? null,
      ...engineFields(planByOption.get(item.optionId)!.plan),
      directGross: directGrossByOption?.get(item.optionId) ?? null,
    })),
    sets: created.sets,
  })
}
