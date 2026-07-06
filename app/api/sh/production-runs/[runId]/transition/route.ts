import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productionRunStatusTransitionSchema } from '@/lib/sh/schemas'
import { applyBatchInbound, MovementError } from '@/lib/inv/movement-processor'

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

  // 입고 완료(STOCKED_IN)는 종료 상태 — ORDERED/PLANNED 로 되돌리는 역행 전환을 차단한다.
  // 되돌려도 이미 반영된 INBOUND 재고는 역산되지 않고(그 사이 판매·이동으로 소비됐을 수 있어
  // 맹목적 역산은 재고를 음수로 만든다), 재전환 시 INBOUND 가 재실행돼 재고가 이중 계상된다.
  // 정정이 필요하면 재고 조정(ADJUSTMENT)으로 처리한다.
  if (existing.status === 'STOCKED_IN') {
    return errorResponse('이미 입고 완료된 차수는 되돌릴 수 없습니다. 재고 조정으로 처리하세요', 409)
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

    // 세트 단위 입고(setStockIns) + 옵션별 위치 입고(allocations)를 **병합**한다.
    // 레이어드/위치 세트 발주: baseline 분은 세트(묶음 상품)로 연동 위치에, 추가분은 옵션으로
    // 사용자 지정 위치에 **동시** 입고. setStockIns 는 ProductListingItem(서버 권위)로 구성옵션 분해 후
    // allocations 와 옵션×위치 키로 합산. (구: setStockIns 가 allocations 를 덮어써 둘 중 하나만 가능했음)
    const setStockInByListing = new Map<string, number>()
    const isSetStockIn = !!(input.setStockIns && input.setStockIns.length > 0)
    const allocMap = new Map<string, { optionId: string; locationId: string; quantity: number }>()
    const mergeAlloc = (optionId: string, locationId: string, quantity: number) => {
      if (quantity <= 0) return
      const key = `${optionId}|${locationId}`
      const entry = allocMap.get(key)
      if (entry) entry.quantity += quantity
      else allocMap.set(key, { optionId, locationId, quantity })
    }
    // (1) 명시적 옵션 allocations(추가분) 먼저 반영
    for (const a of input.allocations ?? []) mergeAlloc(a.optionId, a.locationId, a.quantity)
    // (2) 세트 분해분(baseline) 합산
    if (isSetStockIn) {
      const setByListingId = new Map(existing.sets.map((s) => [s.listingId, s]))
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
          mergeAlloc(it.optionId, si.locationId, si.setQty * it.quantity)
        }
      }
    }
    const allocations = Array.from(allocMap.values())

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

    // ── INBOUND + 상태 갱신을 단일 트랜잭션으로 원자화 ──
    // claim → applyBatchInbound → item/set 갱신이 하나의 tx 안에서 all-or-nothing 처리됨.
    // 상태 선점(updateMany where status=existing.status)으로 동시 요청을 직렬화해 이중 입고를 방지한다.
    const brandPart = existing.brand?.name ? ` · ${existing.brand.name}` : ''
    const batchItems = allocations.map((a) => {
      const it = itemByOptionId.get(a.optionId)!
      const loc = locationById.get(a.locationId)!
      const productName = it.option.product.internalName ?? it.option.product.name
      return {
        optionId: a.optionId,
        locationId: a.locationId,
        quantity: a.quantity,
        reason: `생산 입고 - 차수 ${existing.runNo}${brandPart} · ${productName} / ${it.option.name} · ${a.quantity}개 · 위치 ${loc.name} · 입고일 ${input.transitionDate}`,
        // 옵션×위치별 granular 추적키 — 차수·위치별 입고 내역 후속 조회/집계용 (P3.5).
        referenceId: `prodrun:${existing.id}:${a.optionId}:${a.locationId}`,
      }
    })

    let movementResults: Array<{ optionId: string; locationId: string; stockLevelAfter: number }>
    try {
      movementResults = await prisma.$transaction(
        async (tx) => {
          // 상태 선점 — 읽어온 상태가 그대로일 때만 STOCKED_IN 으로 전환
          const claimed = await tx.productionRun.updateMany({
            where: { id: runId, status: existing.status },
            data: {
              status: 'STOCKED_IN',
              stockedInAt: transitionDate,
              completedAt: transitionDate, // 레거시 호환
              stockInLocationId: distinctLocationIds.length === 1 ? distinctLocationIds[0] : null,
            },
          })
          if (claimed.count !== 1) {
            throw new MovementError('차수 상태가 이미 변경되었습니다. 새로고침 후 다시 시도하세요', 409)
          }

          const results = await applyBatchInbound(tx, resolved.space.id, batchItems, transitionDate)

          // 모든 옵션에 실입고량 기록 (분배 없는 옵션 = 0)
          for (const it of existing.items) {
            await tx.productionRunItem.update({
              where: { id: it.id },
              data: { stockedInQty: allocSumByOptionId.get(it.optionId) ?? 0 },
            })
          }
          // 세트 단위 입고면 세트별 실입고 세트수 기록 (입고 안 된 세트 = 0)
          if (isSetStockIn) {
            for (const s of existing.sets) {
              await tx.productionRunSet.update({
                where: { id: s.id },
                data: { stockedInSetQty: setStockInByListing.get(s.listingId) ?? 0 },
              })
            }
          }

          return results
        },
        { maxWait: 10_000, timeout: 60_000 }
      )
    } catch (e) {
      if (e instanceof MovementError) {
        return errorResponse(e.message, e.status)
      }
      throw e
    }

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
