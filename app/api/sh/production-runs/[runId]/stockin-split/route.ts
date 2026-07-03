// GET /api/sh/production-runs/[runId]/stockin-split
// 레이어드 발주 차수의 입고 분배 프리필 데이터 — 옵션별 baseline(연동 위치 세트분) / 추가분 분할 + 로켓 위치.
//
// baseline = min(발주수량, ceil(rocketGross)),  추가분 = 발주수량 − baseline  (min/max 분할, 옵션 단위)
// 로켓그로스 판매 granularity 는 옵션(단품) 단위라 세트가 아닌 **옵션으로 연동 위치 입고**한다
// (중복/부분겹침 세트를 세트수량으로 입고하면 공유 옵션이 ×N 과다집계됨 — 옵션 중심 통일과 정합).
// 비레이어드(rocketGross 없음)·미연계 차수는 { layered:false } → 다이얼로그가 기존 기본 프리필 사용.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { computeSetAvailable } from '@/lib/sh/set-plan-calc'

type Params = { params: Promise<{ runId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id
  const { runId } = await params

  const run = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId },
    select: {
      id: true,
      reorderPlanId: true,
      items: { select: { optionId: true, quantity: true } },
    },
  })
  if (!run) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  const empty = { layered: false as const, rocketLocation: null, options: [] }
  if (!run.reorderPlanId) return NextResponse.json(empty)

  // 연계 플랜의 옵션별 로켓 baseline(rocketGrossQty). 비레이어드 플랜은 전부 null → layered:false.
  const planItems = await prisma.reorderPlanItem.findMany({
    where: { planId: run.reorderPlanId, rocketGrossQty: { not: null } },
    select: { optionId: true, rocketGrossQty: true },
  })
  if (planItems.length === 0) return NextResponse.json(empty)

  const baselineByOption = new Map<string, number>()
  for (const pi of planItems) {
    baselineByOption.set(pi.optionId, Math.ceil(Number(pi.rocketGrossQty ?? 0)))
  }

  const rocketLocation = await prisma.invStorageLocation.findFirst({
    where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH, isActive: true },
    select: { id: true, name: true },
  })

  const options = run.items.map((it) => {
    const baseline = Math.min(it.quantity, baselineByOption.get(it.optionId) ?? 0)
    return {
      optionId: it.optionId,
      baselineQty: baseline,
      additionalQty: Math.max(0, it.quantity - baseline),
    }
  })

  // 묶음 상품(세트) 기준 확인 뷰 — baseline(연동 위치 입고분)을 플랜 세트 구성으로 역산.
  // 표시 전용(재고 write 아님) — 옵션 단위 입고는 그대로, 이 뷰로 "세트 몇 개분"을 구분 확인.
  // 구성 옵션이 겹치는 여러 세트는 각각 대안적 환산(합산 아님) — over-count 없음.
  const baselineStockByOption = new Map<string, number>()
  for (const o of options) baselineStockByOption.set(o.optionId, o.baselineQty)
  const planSets = await prisma.reorderPlanSet.findMany({
    where: { planId: run.reorderPlanId },
    orderBy: { sortOrder: 'asc' },
    select: {
      listingName: true,
      listing: {
        select: {
          items: {
            orderBy: { sortOrder: 'asc' },
            select: { optionId: true, quantity: true, option: { select: { name: true } } },
          },
        },
      },
    },
  })
  const sets = planSets.map((s) => {
    const items = s.listing.items.map((it) => ({
      optionId: it.optionId,
      perSet: it.quantity,
      optionName: it.option.name,
    }))
    return {
      listingName: s.listingName,
      setQty: computeSetAvailable(items, baselineStockByOption),
      items,
    }
  })

  return NextResponse.json({ layered: true, rocketLocation, options, sets })
}
