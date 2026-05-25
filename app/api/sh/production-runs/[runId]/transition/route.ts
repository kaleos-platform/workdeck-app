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

  // STOCKED_IN 전환: 재고 입고 + 상태 + 타임스탬프 갱신
  if (input.status === 'STOCKED_IN') {
    if (!input.locationId) {
      return errorResponse('보관 위치를 선택하세요', 400)
    }

    // 위치 검증
    const location = await prisma.invStorageLocation.findFirst({
      where: { id: input.locationId, spaceId: resolved.space.id },
    })
    if (!location) return errorResponse('보관 위치를 찾을 수 없습니다', 404)
    if (!location.isActive) return errorResponse('비활성화된 보관 위치입니다', 400)

    // 비활성 옵션 사전 차단
    const inactive = existing.items.find((it) => it.option.product.status !== 'ACTIVE')
    if (inactive) {
      return errorResponse(
        `옵션 "${inactive.option.name}"이(가) 속한 상품이 미사용 상태입니다. 사용 재개 후 처리하세요`,
        400
      )
    }
    if (existing.items.length === 0) {
      return errorResponse('입고할 옵션이 없습니다', 400)
    }

    // 옵션별로 INBOUND 처리 (movement-processor 가 자체 트랜잭션)
    const brandPart = existing.brand?.name ? ` · ${existing.brand.name}` : ''
    const movementResults: Array<{ optionId: string; stockLevelAfter: number }> = []
    try {
      for (const it of existing.items) {
        const productName = it.option.product.internalName ?? it.option.product.name
        const reason = `생산 입고 - 차수 ${existing.runNo}${brandPart} · ${productName} / ${it.option.name} · ${it.quantity}개 · 위치 ${location.name} · 입고일 ${input.transitionDate}`
        const result = await processMovement(resolved.space.id, {
          type: 'INBOUND',
          optionId: it.optionId,
          locationId: input.locationId,
          quantity: it.quantity,
          movementDate: input.transitionDate,
          reason,
          referenceId: existing.id,
        })
        movementResults.push({
          optionId: it.optionId,
          stockLevelAfter: result.stockLevelAfter,
        })
      }
    } catch (e) {
      if (e instanceof MovementError) {
        return errorResponse(`재고 입고 실패: ${e.message}`, e.status)
      }
      throw e
    }

    // 상태 + 타임스탬프 + 위치 갱신
    await prisma.productionRun.update({
      where: { id: runId },
      data: {
        status: 'STOCKED_IN',
        stockedInAt: transitionDate,
        completedAt: transitionDate, // 레거시 호환
        stockInLocationId: input.locationId,
      },
    })

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

  await prisma.productionRun.update({
    where: { id: runId },
    data,
  })

  return NextResponse.json({ run: { id: runId, status: input.status } })
}
