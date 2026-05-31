// GET /api/sh/inventory/reorder/plan/[planId]
// 발주 계획 헤더 + 아이템 조회

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const { planId } = await params

  const plan = await prisma.reorderPlan.findUnique({
    where: { id: planId },
    include: {
      items: {
        include: {
          option: { select: { id: true, name: true, sku: true, deletedAt: true } },
          product: {
            select: {
              id: true,
              name: true,
              internalName: true,
              code: true,
              brand: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { product: { name: 'asc' } },
      },
      accuracies: {
        select: {
          optionId: true,
          wape: true,
          bias: true,
          stockoutDays: true,
          overstockDays: true,
          evaluatedAt: true,
        },
      },
    },
  })

  if (!plan || plan.spaceId !== spaceId) {
    return errorResponse('발주 계획을 찾을 수 없습니다', 404)
  }

  // productInfo: 상품 단위로 그룹핑하여 옵션 배열 형태로 재구성
  const productInfoMap = new Map<
    string,
    {
      productId: string
      productName: string
      productCode: string | null
      brandName: string | null
      options: Array<{
        optionId: string
        optionName: string
        sku: string | null
        optionDeleted: boolean
      }>
    }
  >()

  for (const item of plan.items) {
    const pid = item.product.id
    if (!productInfoMap.has(pid)) {
      productInfoMap.set(pid, {
        productId: pid,
        productName: item.product.name ?? item.product.internalName ?? '',
        productCode: item.product.code ?? null,
        brandName: item.product.brand?.name ?? null,
        options: [],
      })
    }
    const entry = productInfoMap.get(pid)!
    if (!entry.options.find((o) => o.optionId === item.option.id)) {
      entry.options.push({
        optionId: item.option.id,
        optionName: item.option.name,
        sku: item.option.sku ?? null,
        optionDeleted: item.option.deletedAt != null,
      })
    }
  }

  return NextResponse.json({
    plan: {
      id: plan.id,
      planNo: plan.planNo,
      status: plan.status,
      windowDays: plan.windowDays,
      finalizedAt: plan.finalizedAt,
      biasAdjustApplied: plan.biasAdjustApplied,
      totalSuggestedQty: plan.totalSuggestedQty,
      totalFinalQty: plan.totalFinalQty,
      memo: plan.memo,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    },
    items: plan.items.map((item) => ({
      id: item.id,
      planId: item.planId,
      optionId: item.optionId,
      productId: item.productId,
      currentStock: item.currentStock,
      dailyAvgForecast: Number(item.dailyAvgForecast),
      forecastModel: item.forecastModel,
      leadTimeDays: item.leadTimeDays,
      safetyStockQty: item.safetyStockQty,
      suggestedQty: item.suggestedQty,
      roundedSuggestedQty: item.roundedSuggestedQty,
      finalQty: item.finalQty,
      roundUnit: item.roundUnit,
      rationale: item.rationale,
      userNote: item.userNote,
      biasAdjustFactor: Number(item.biasAdjustFactor),
      confidenceScore: item.confidenceScore ? Number(item.confidenceScore) : null,
      inputsSnapshot: item.inputsSnapshot,
    })),
    productInfo: Array.from(productInfoMap.values()),
    accuracies: plan.accuracies.map((a) => ({
      ...a,
      wape: Number(a.wape),
      bias: Number(a.bias),
    })),
  })
}
