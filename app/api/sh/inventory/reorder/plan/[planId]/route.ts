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
          option: { select: { id: true, name: true, sku: true } },
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

  return NextResponse.json({
    id: plan.id,
    planNo: plan.planNo,
    status: plan.status,
    windowDays: plan.windowDays,
    totalSuggestedQty: plan.totalSuggestedQty,
    totalFinalQty: plan.totalFinalQty,
    memo: plan.memo,
    finalizedAt: plan.finalizedAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    items: plan.items.map((item) => ({
      id: item.id,
      optionId: item.optionId,
      productId: item.productId,
      option: item.option,
      product: item.product,
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
    accuracies: plan.accuracies.map((a) => ({
      ...a,
      wape: Number(a.wape),
      bias: Number(a.bias),
    })),
  })
}
