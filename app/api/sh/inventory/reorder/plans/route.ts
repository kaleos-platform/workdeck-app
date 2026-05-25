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
  const plans = await prisma.reorderPlan.findMany({
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
    },
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
        },
      },
    },
  })

  const latestAccuracy = latestConsumed
    ? {
        planNo: latestConsumed.planNo,
        biasAdjustApplied: latestConsumed.biasAdjustApplied as object | null,
        accuracies: latestConsumed.accuracies.map((a) => ({
          optionId: a.optionId,
          wape: a.wape,
          bias: a.bias,
          stockoutDays: a.stockoutDays,
          overstockDays: a.overstockDays,
        })),
      }
    : undefined

  return NextResponse.json({
    plans,
    ...(latestAccuracy !== undefined ? { latestAccuracy } : {}),
  })
}
