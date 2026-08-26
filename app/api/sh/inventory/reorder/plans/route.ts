// GET /api/sh/inventory/reorder/plans
// 발주 계획 목록 조회 (최근 50건) + 가장 최근 CONSUMED 계획의 적중률
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  // 최근 50개 계획 목록
  const plansRaw = await prisma.reorderPlan.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      planNo: true,
      status: true,
      windowDays: true,
      totalSuggestedQty: true,
      totalFinalQty: true,
      finalizedAt: true,
      createdAt: true,
      productId: true,
      product: { select: { name: true, internalName: true } },
    },
  })

  // productName: 상품 단위 계획이면 상품명, 레거시 전체-계획이면 null
  const plans = plansRaw.map((p) => {
    const { product, ...rest } = p
    return {
      ...rest,
      productName: product ? (product.name ?? product.internalName ?? null) : null,
    }
  })

  // 가장 최근 CONSUMED 계획의 적중률 정보
  const latestConsumed = await prisma.reorderPlan.findFirst({
    where: { spaceId, status: 'CONSUMED' },
    orderBy: { finalizedAt: 'desc' },
    select: {
      planNo: true,
      biasAdjustApplied: true,
      accuracies: {
        select: {
          optionId: true,
          wape: true,
          bias: true,
          stockoutDays: true,
          overstockDays: true,
          // 실적 모니터링 비교표 — 리드타임 구간의 예측 출고 vs 실 출고.
          // 발주 수량(totalFinalQty)과는 기준이 다르므로 섞어 쓰지 않는다.
          actualOutbound: true,
          forecastOutbound: true,
        },
      },
    },
  })

  // 옵션명 — 모니터링 표에서 optionId만으로는 읽을 수 없다.
  const accuracyOptionIds = latestConsumed?.accuracies.map((a) => a.optionId) ?? []
  const optionNameById = new Map<string, { name: string; sku: string | null }>()
  if (accuracyOptionIds.length > 0) {
    const opts = await prisma.invProductOption.findMany({
      where: { id: { in: accuracyOptionIds }, product: { spaceId } },
      select: { id: true, name: true, sku: true },
    })
    for (const o of opts) optionNameById.set(o.id, { name: o.name, sku: o.sku })
  }

  const latestAccuracy = latestConsumed
    ? {
        planNo: latestConsumed.planNo,
        biasAdjustApplied: latestConsumed.biasAdjustApplied as object | null,
        accuracies: latestConsumed.accuracies.map((a) => ({
          optionId: a.optionId,
          optionName: optionNameById.get(a.optionId)?.name ?? null,
          sku: optionNameById.get(a.optionId)?.sku ?? null,
          // Decimal → number (클라이언트가 그대로 산술에 사용)
          wape: Number(a.wape),
          bias: Number(a.bias),
          stockoutDays: a.stockoutDays,
          overstockDays: a.overstockDays,
          actualOutbound: a.actualOutbound,
          forecastOutbound: Number(a.forecastOutbound),
        })),
      }
    : undefined

  return NextResponse.json({
    plans,
    ...(latestAccuracy !== undefined ? { latestAccuracy } : {}),
  })
}
