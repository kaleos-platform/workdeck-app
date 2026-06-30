import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunStatusTransitionSchema } from '@/lib/sh/schemas'
import { processMovement, MovementError } from '@/lib/inv/movement-processor'

type Params = { params: Promise<{ runId: string }> }

// 생산 차수 상태 전환 — PLANNED ↔ ORDERED ↔ STOCKED_IN
// STOCKED_IN 전환 시 모든 옵션 수량을 지정된 보관 위치에 INBOUND 처리.
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { runId } = await params

  const existing = await prisma.productionRun.findFirst({
    where: { id: runId, spaceId: resolved.space.id },
    include: {
      brand: { select: { name: true } },
      items: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              product: {
                select: {
                  status: true,
                  name: true,
                  internalName: true,
                },
              },
            },
          },
        },
      },
      // 세트 기반 차수면 세트별 구성(listing 라이브 조인) — 세트 단위 입고 분해용
      sets: {
        select: {
          id: true,
          listingId: true,
          listing: { select: { items: { select: { optionId: true, quantity: true } } } },
        },
      },
    },
  })
  if (!existing) return errorResponse('생산 발주를 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = productionRunStatusTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { issues: parsed.error.issues })
  }
  const input = parsed.data

  if (input.status === existing.status) {
    return errorResponse(`이미 ${input.status} 상태입니다`, 409)
  }

  const transitionDate = new Date(input.transitionDate)
  if (isNaN(transitionDate.getTime())) {
    return errorResponse('전환 일자가 올바르지 않습니다', 400)
  }

  // STOCKED_IN 전환: 옵션별 보관 위치 분배 INBOUND + 상태 + 타임스탬프 + 실입고량 기록
  // 실입고량은 발주 수량과 달라도 됨(양방향). 미입고 옵션은 분배 부재로 표현(stockedInQty=0).
  if (input.status === 'STOCKED_IN') {
    if (existing.items.length === 0) {
      return errorResponse('입고할 옵션이 없습니다', 400)
    }

    // 세트 단위 입고: setStockIns → 구성옵션 allocations 분해 (서버 권위 = ProductListingItem).
    // 값이 있으면 allocations 보다 우선. setStockInByListing 은 ProductionRunSet.stockedInSetQty 기록용.
    let allocations = input.allocations ?? []
    const setStockInByListing = new Map<string, number>()
    const isSetStockIn = !!(input.setStockIns && input.setStockIns.length > 0)
    if (isSetStockIn) {
      const setByListingId = new Map(existing.sets.map((s) => [s.listingId, s]))
      const allocMap = new Map<string, { optionId: string; locationId: string; quantity: number }>()
      for (const si of input.setStockIns!) {
        const set = setByListingId.get(si.listingId)
        if (!set) {
          return errorResponse('차수에 없는 세트가 입고에 포함되어 있습니다', 400)
        }
        setStockInByListing.set(
          si.listingId,
          (setStockInByListing.get(si.listingId) ?? 0) + si.setQty
        )
        for (const it of set.listing.items) {
          const qty = si.setQty * it.quantity
          if (qty <= 0) continue
          const key = `${it.optionId}|${si.locationId}`
          const entry = allocMap.get(key)
          if (entry) entry.quantity += qty
          else
            allocMap.set(key, { optionId: it.optionId, locationId: si.locationId, quantity: qty })
        }
      }
      allocations = Array.from(allocMap.values())
    }

    // 비활성 옵션 사전 차단
    const inactive = existing.items.find((it) => it.option.product.status !== 'ACTIVE')
    if (inactive) {
      return errorResponse(
        `옵션 "${inactive.option.name}"이(가) 속한 상품이 미사용 상태입니다. 사용 재개 후 처리하세요`,
        400
      )
    }

    // ── 선검증 (movement 호출 전에 전부 통과시킨다) ──

    // 1) stray optionId 차단 — 분배의 모든 옵션이 차수에 존재해야 함
    const itemByOptionId = new Map(existing.items.map((it) => [it.optionId, it]))
    for (const a of allocations) {
      if (!itemByOptionId.has(a.optionId)) {
        return errorResponse('차수에 없는 옵션이 분배에 포함되어 있습니다', 400)
      }
    }

    // 2) 옵션별 실입고 합 집계 (발주 수량 일치 검증 없음 — 양방향 차이 허용)
    const allocSumByOptionId = new Map<string, number>()
    for (const a of allocations) {
      allocSumByOptionId.set(a.optionId, (allocSumByOptionId.get(a.optionId) ?? 0) + a.quantity)
    }

    // 3) 분배에 쓰인 모든 distinct 위치 조회·검증 (in-space + isActive)
    const distinctLocationIds = [...new Set(allocations.map((a) => a.locationId))]
    const locations =
      distinctLocationIds.length > 0
        ? await prisma.invStorageLocation.findMany({
            where: { id: { in: distinctLocationIds }, spaceId: resolved.space.id },
          })
        : []
    const locationById = new Map(locations.map((l) => [l.id, l]))
    for (const locId of distinctLocationIds) {
      const loc = locationById.get(locId)
      if (!loc) return errorResponse('보관 위치를 찾을 수 없습니다', 404)
      if (!loc.isActive) return errorResponse(`비활성화된 보관 위치입니다: ${loc.name}`, 400)
    }

    // ── 분배별 INBOUND 처리 (movement-processor 가 자체 트랜잭션) ──
    // 주의: movement N건이 각자 트랜잭션 후 마지막에 status/실입고량 갱신하는 best-effort 구조.
    // 부분실패 노출 구조는 1차와 동일. 선검증으로 흔한 에러는 write 전 차단.
    const brandPart = existing.brand?.name ? ` · ${existing.brand.name}` : ''
    const movementResults: Array<{
      optionId: string
      locationId: string
      stockLevelAfter: number
    }> = []
    try {
      for (const a of allocations) {
        const it = itemByOptionId.get(a.optionId)!
        const loc = locationById.get(a.locationId)!
        const productName = it.option.product.internalName ?? it.option.product.name
        const reason = `생산 입고 - 차수 ${existing.runNo}${brandPart} · ${productName} / ${it.option.name} · ${a.quantity}개 · 위치 ${loc.name} · 입고일 ${input.transitionDate}`
        const result = await processMovement(resolved.space.id, {
          type: 'INBOUND',
          optionId: a.optionId,
          locationId: a.locationId,
          quantity: a.quantity,
          movementDate: input.transitionDate,
          reason,
          // 옵션×위치별 granular 추적키 — 차수·위치별 입고 내역 후속 조회/집계용 (P3.5).
          referenceId: `prodrun:${existing.id}:${a.optionId}:${a.locationId}`,
        })
        movementResults.push({
          optionId: a.optionId,
          locationId: a.locationId,
          stockLevelAfter: result.stockLevelAfter,
        })
      }
    } catch (e) {
      if (e instanceof MovementError) {
        return errorResponse(`재고 입고 실패: ${e.message}`, e.status)
      }
      throw e
    }

    // 상태 + 타임스탬프 + 위치 + 옵션별 실입고량 갱신 (트랜잭션 묶음)
    // stockInLocationId: 분배 위치가 1개면 그 값, 0/2개 이상이면 null (단일 FK라 분할/미입고 표현 불가)
    await prisma.$transaction([
      prisma.productionRun.update({
        where: { id: runId },
        data: {
          status: 'STOCKED_IN',
          stockedInAt: transitionDate,
          completedAt: transitionDate, // 레거시 호환
          stockInLocationId: distinctLocationIds.length === 1 ? distinctLocationIds[0] : null,
        },
      }),
      // 모든 옵션에 실입고량 기록 (분배 없는 옵션 = 0)
      ...existing.items.map((it) =>
        prisma.productionRunItem.update({
          where: { id: it.id },
          data: { stockedInQty: allocSumByOptionId.get(it.optionId) ?? 0 },
        })
      ),
      // 세트 단위 입고면 세트별 실입고 세트수 기록 (입고 안 된 세트 = 0)
      ...(isSetStockIn
        ? existing.sets.map((s) =>
            prisma.productionRunSet.update({
              where: { id: s.id },
              data: { stockedInSetQty: setStockInByListing.get(s.listingId) ?? 0 },
            })
          )
        : []),
    ])

    return NextResponse.json({
      run: { id: runId, status: 'STOCKED_IN' },
      movements: movementResults,
    })
  }

  // PLANNED / ORDERED 전환 — 재고 영향 없음
  const data: Record<string, unknown> = { status: input.status }
  if (input.status === 'ORDERED') {
    data.orderedConfirmedAt = transitionDate
  }
  // PLANNED 로 되돌리는 회귀 전환은 타임스탬프 보존(이력으로 남김)

  // PLANNED 회귀 시 실입고량 clear (재입고 시 stale 방지)
  if (input.status === 'PLANNED') {
    await prisma.$transaction([
      prisma.productionRun.update({ where: { id: runId }, data }),
      prisma.productionRunItem.updateMany({
        where: { runId },
        data: { stockedInQty: null },
      }),
      prisma.productionRunSet.updateMany({
        where: { runId },
        data: { stockedInSetQty: null },
      }),
    ])
  } else {
    await prisma.productionRun.update({ where: { id: runId }, data })
  }

  return NextResponse.json({ run: { id: runId, status: input.status } })
}
