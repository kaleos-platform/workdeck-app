import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunSchema } from '@/lib/sh/schemas'
import {
  buildProductionStatusTabs,
  compareProductionRunRows,
  parseProductionRunsQuery,
  type ProductionRunStatus,
} from '@/lib/sh/production-runs-query'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const query = parseProductionRunsQuery(req.nextUrl.searchParams)
  const productId = req.nextUrl.searchParams.get('productId')?.trim() || null

  const baseWhere: Prisma.ProductionRunWhereInput = { spaceId: resolved.space.id }

  // productId 필터 — 해당 상품의 옵션이 1개라도 포함된 run만
  if (productId) {
    baseWhere.items = { some: { option: { productId } } }
  }

  // 브랜드 필터
  if (query.brandId) {
    baseWhere.brandId = query.brandId
  }

  if (query.search) {
    baseWhere.OR = [
      { runNo: { contains: query.search, mode: 'insensitive' } },
      { memo: { contains: query.search, mode: 'insensitive' } },
      {
        items: {
          some: {
            option: {
              product: {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { internalName: { contains: query.search, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      },
    ]
  }

  const where: Prisma.ProductionRunWhereInput = query.status
    ? { ...baseWhere, status: query.status }
    : baseWhere

  const [runs, total, statusGroups] = await Promise.all([
    prisma.productionRun.findMany({
      where,
      orderBy: [{ orderedConfirmedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: {
        brand: { select: { id: true, name: true } },
        items: {
          include: {
            option: {
              select: {
                id: true,
                name: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    internalName: true,
                    brand: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        },
        // 세트 기반 차수의 세트 라인 (세트 단위 입고 UI·이력용)
        sets: {
          select: {
            id: true,
            listingId: true,
            listingName: true,
            plannedSetQty: true,
            stockedInSetQty: true,
          },
        },
        // 입고 위치 (세트 입고 breakdown 표시 + FC 이관 게이팅: externalSource=null 이면 자체창고)
        stockInLocation: { select: { id: true, name: true, externalSource: true } },
        // 연계 발주 계획의 대상 연동 위치 (FC 이관 목적지 프리필)
        reorderPlan: {
          select: { locationId: true, location: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.productionRun.count({ where }),
    prisma.productionRun.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    }),
  ])

  const data = runs.map((run) => {
    const totalQuantity = run.items.reduce((s, it) => s + it.quantity, 0)
    const totalCostNum = run.totalCost != null ? Number(run.totalCost) : null
    const averageUnitCost =
      totalCostNum != null && totalQuantity > 0 ? totalCostNum / totalQuantity : null

    // distinct products
    const productMap = new Map<
      string,
      { id: string; displayName: string; brandName: string | null }
    >()
    for (const it of run.items) {
      const p = it.option.product
      if (!productMap.has(p.id)) {
        productMap.set(p.id, {
          id: p.id,
          displayName: p.internalName ?? p.name,
          brandName: p.brand?.name ?? null,
        })
      }
    }
    const products = Array.from(productMap.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'ko-KR', { numeric: true, sensitivity: 'base' })
    )

    return {
      id: run.id,
      runNo: run.runNo,
      status: run.status,
      brand: run.brand ? { id: run.brand.id, name: run.brand.name } : null,
      brandName: run.brand?.name ?? null,
      firstProductName: products[0]?.displayName ?? null,
      dueAt: run.dueAt ? run.dueAt.toISOString() : null,
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      orderedConfirmedAt: run.orderedConfirmedAt ? run.orderedConfirmedAt.toISOString() : null,
      stockedInAt: run.stockedInAt ? run.stockedInAt.toISOString() : null,
      stockInLocationId: run.stockInLocationId,
      // 입고 위치 상세 (세트 breakdown 표시 + FC 이관 게이팅용)
      stockInLocation: run.stockInLocation
        ? {
            id: run.stockInLocation.id,
            name: run.stockInLocation.name,
            externalSource: run.stockInLocation.externalSource,
          }
        : null,
      // 연계 발주 계획의 대상 연동 위치 (FC 이관 목적지 기본값)
      planLocation: run.reorderPlan?.location
        ? { id: run.reorderPlan.location.id, name: run.reorderPlan.location.name }
        : null,
      totalCost: totalCostNum,
      costMode: run.costMode,
      memo: run.memo,
      itemCount: run.items.length,
      totalQuantity,
      averageUnitCost,
      products,
      items: run.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        productId: it.option.product.id,
        productName: it.option.product.internalName ?? it.option.product.name,
        quantity: it.quantity,
        stockedInQty: it.stockedInQty,
      })),
      // 세트 라인 (세트 기반 차수만 비어있지 않음)
      sets: run.sets.map((s) => ({
        id: s.id,
        listingId: s.listingId,
        listingName: s.listingName,
        plannedSetQty: s.plannedSetQty,
        stockedInSetQty: s.stockedInSetQty,
      })),
      updatedAt: run.updatedAt.toISOString(),
    }
  })

  const sortedData = data.sort(compareProductionRunRows(query.sortBy, query.sortOrder))
  const pageData = sortedData.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  const counts = statusGroups.reduce<Partial<Record<ProductionRunStatus, number>>>((acc, group) => {
    acc[group.status as ProductionRunStatus] = group._count._all
    return acc
  }, {})

  return NextResponse.json({
    data: pageData,
    total,
    page: query.page,
    pageSize: query.pageSize,
    statusTabs: buildProductionStatusTabs(counts),
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = productionRunSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 옵션 소속 검증 — 모두 같은 spaceId에 속해야 함, brandId 자동 추정을 위해 product.brandId 포함
  const optionIds = input.items.map((it) => it.optionId)
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
    select: { id: true, product: { select: { brandId: true } } },
  })
  if (validOptions.length !== optionIds.length) {
    return errorResponse('일부 옵션을 찾을 수 없습니다', 400)
  }

  // brandId 처리 — 명시되지 않으면 옵션들의 distinct brandId가 1개면 자동 추정
  let resolvedBrandId: string | null | undefined = undefined
  if ('brandId' in body) {
    // 명시적으로 전달된 경우
    if (input.brandId) {
      // brandId 소속 검증 (spaceId 일치 여부)
      const brand = await prisma.brand.findFirst({
        where: { id: input.brandId, spaceId: resolved.space.id },
        select: { id: true },
      })
      if (!brand) return errorResponse('브랜드를 찾을 수 없습니다', 400)
      resolvedBrandId = input.brandId
    } else {
      resolvedBrandId = null // 명시적 null
    }
  } else {
    // 자동 추정: 옵션들의 distinct brandId가 1개면 그 brandId, 아니면 null
    const brandIds = new Set(
      validOptions.map((o) => o.product.brandId).filter((id): id is string => id != null)
    )
    resolvedBrandId = brandIds.size === 1 ? Array.from(brandIds)[0] : null
  }

  // 두 모드 공통: costs 행 amount 계산
  // BREAKDOWN: totalCost = costs amount 합
  // TOTAL: totalCost = body.totalCost (클라이언트 합산값) — costs 행도 함께 저장
  const costsData: Array<{
    itemName: string
    description?: string
    spec?: number
    quantity: number
    unitPrice: number
    amount: number
    note?: string
    sortOrder: number
    category: 'MATERIAL' | 'LABOR' | 'PACKAGING' | 'LOGISTICS' | 'OTHER'
  }> = (input.costs ?? []).map((c, i) => ({
    itemName: c.itemName,
    description: c.description,
    spec: c.spec,
    quantity: c.quantity,
    unitPrice: c.unitPrice,
    amount: (c.spec ?? 1) * c.quantity * c.unitPrice,
    note: c.note,
    sortOrder: c.sortOrder ?? i,
    category: c.category,
  }))
  const finalTotalCost: number | undefined =
    input.costMode === 'BREAKDOWN' ? costsData.reduce((s, c) => s + c.amount, 0) : input.totalCost

  // 연계 발주 계획 소속 검증 (다른 space의 planId 주입 방어)
  if (input.reorderPlanId) {
    const plan = await prisma.reorderPlan.findFirst({
      where: { id: input.reorderPlanId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!plan) return errorResponse('연계 발주 계획을 찾을 수 없습니다', 400)
  }

  // 세트(listing) 소속 검증 + 이름 스냅샷 (다른 space의 listingId 주입 방어, 0 세트는 제외)
  const setInputs = (input.sets ?? []).filter((s) => s.plannedSetQty > 0)
  const setNameById = new Map<string, string>()
  if (setInputs.length > 0) {
    const listingIds = Array.from(new Set(setInputs.map((s) => s.listingId)))
    const listings = await prisma.productListing.findMany({
      where: { id: { in: listingIds }, spaceId: resolved.space.id },
      select: { id: true, searchName: true, managementName: true },
    })
    if (listings.length !== listingIds.length) {
      return errorResponse('일부 세트(listing)를 찾을 수 없습니다', 400)
    }
    for (const l of listings) {
      setNameById.set(l.id, l.managementName?.trim() || l.searchName)
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const run = await tx.productionRun.create({
        data: {
          spaceId: resolved.space.id,
          runNo: input.runNo,
          costMode: input.costMode,
          totalCost: finalTotalCost ?? null,
          memo: input.memo ?? null,
          status: input.status ?? 'PLANNED',
          brandId: resolvedBrandId ?? null,
          reorderPlanId: input.reorderPlanId ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          completedAt: input.completedAt ? new Date(input.completedAt) : null,
        },
      })

      await tx.productionRunItem.createMany({
        data: input.items.map((it) => ({
          runId: run.id,
          optionId: it.optionId,
          quantity: it.quantity,
        })),
      })

      if (setInputs.length > 0) {
        await tx.productionRunSet.createMany({
          data: setInputs.map((s) => ({
            runId: run.id,
            listingId: s.listingId,
            listingName: setNameById.get(s.listingId) ?? '',
            plannedSetQty: s.plannedSetQty,
          })),
        })
      }

      if (costsData.length > 0) {
        await tx.productionRunCost.createMany({
          data: costsData.map((c) => ({ ...c, runId: run.id })),
        })
      }

      return run
    })

    return NextResponse.json({ run: { id: created.id } }, { status: 201 })
  } catch (e) {
    // unique 충돌 (spaceId, runNo)
    if (
      e instanceof Error &&
      e.message.includes('Unique constraint') &&
      e.message.includes('runNo')
    ) {
      return errorResponse('같은 차수 번호가 이미 존재합니다', 409)
    }
    // Prisma P2002
    const prismaErr = e as { code?: string }
    if (prismaErr.code === 'P2002') {
      return errorResponse('같은 차수 번호가 이미 존재합니다', 409)
    }
    throw e
  }
}
