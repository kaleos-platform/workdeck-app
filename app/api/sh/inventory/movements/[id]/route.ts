import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { lockStockLevel, reverseMovement, MovementError } from '@/lib/inv/movement-processor'

type RouteContext = { params: Promise<{ id: string }> }

const EXTERNAL_SOURCE_MSG =
  '외부 출처(파일 업로드/대조)로 생성된 이동은 강제 수정·삭제할 수 없습니다'

async function findMovement(spaceId: string, id: string) {
  return prisma.invMovement.findFirst({ where: { id, spaceId } })
}

// DELETE — 이동 기록 강제 삭제 + 재고 자동 역산
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const movement = await findMovement(resolved.space.id, id)
  if (!movement) return errorResponse('이동 기록을 찾을 수 없습니다', 404)
  if (movement.importHistoryId) {
    return errorResponse(EXTERNAL_SOURCE_MSG, 400)
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockStockLevel(tx, movement.optionId, movement.locationId)
      if (movement.type === 'TRANSFER' && movement.toLocationId) {
        await lockStockLevel(tx, movement.optionId, movement.toLocationId)
      }
      await reverseMovement(tx, resolved.space.id, movement)
      await tx.invMovement.delete({ where: { id } })
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof MovementError) {
      return errorResponse(err.message, err.status)
    }
    console.error('[DELETE /api/inv/movements/[id]] 실패', err)
    return errorResponse('이동 기록 삭제에 실패했습니다', 500)
  }
}

// PATCH — quantity/movementDate/reason/orderDate만 변경 가능
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { id } = await ctx.params
  const movement = await findMovement(resolved.space.id, id)
  if (!movement) return errorResponse('이동 기록을 찾을 수 없습니다', 404)
  if (movement.importHistoryId) {
    return errorResponse(EXTERNAL_SOURCE_MSG, 400)
  }

  const body = (await req.json().catch(() => ({}))) as {
    quantity?: number
    movementDate?: string
    reason?: string | null
    orderDate?: string | null
  }

  const patch: {
    quantity?: number
    movementDate?: Date
    reason?: string | null
    orderDate?: Date | null
  } = {}

  if (body.quantity !== undefined) {
    const q = Number(body.quantity)
    if (!Number.isFinite(q) || !Number.isInteger(q)) {
      return errorResponse('quantity가 유효하지 않습니다', 400)
    }
    if (movement.type !== 'ADJUSTMENT' && q <= 0) {
      return errorResponse(`${movement.type} 수량은 양수여야 합니다`, 400)
    }
    patch.quantity = q
  }
  if (body.movementDate !== undefined) {
    const d = new Date(body.movementDate)
    if (Number.isNaN(d.getTime())) return errorResponse('movementDate가 유효하지 않습니다', 400)
    patch.movementDate = d
  }
  if (body.reason !== undefined) {
    patch.reason = body.reason === null ? null : String(body.reason).trim() || null
    if (movement.type === 'ADJUSTMENT' && !patch.reason) {
      return errorResponse('ADJUSTMENT는 reason이 필수입니다', 400)
    }
  }
  if (body.orderDate !== undefined) {
    if (body.orderDate === null) {
      patch.orderDate = null
    } else {
      const d = new Date(body.orderDate)
      if (Number.isNaN(d.getTime())) return errorResponse('orderDate가 유효하지 않습니다', 400)
      patch.orderDate = d
    }
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse('변경할 필드가 없습니다', 400)
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await lockStockLevel(tx, movement.optionId, movement.locationId)
      if (movement.type === 'TRANSFER' && movement.toLocationId) {
        await lockStockLevel(tx, movement.optionId, movement.toLocationId)
      }

      // 1) 원본 효과 역산
      await reverseMovement(tx, resolved.space.id, movement)

      // 2) 새 quantity로 stock에 효과 적용 (행 update는 별도)
      const newQuantity = patch.quantity ?? movement.quantity
      const newMovement = { ...movement, quantity: newQuantity }
      // reverse의 반대 부호로 적용 = 원본 효과를 새 수량으로 다시 가하기
      await applyMovementEffect(tx, resolved.space.id, newMovement)

      // 3) 행 update
      return tx.invMovement.update({
        where: { id },
        data: {
          ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
          ...(patch.movementDate !== undefined ? { movementDate: patch.movementDate } : {}),
          ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          ...(patch.orderDate !== undefined ? { orderDate: patch.orderDate } : {}),
        },
      })
    })
    return NextResponse.json({ movement: updated })
  } catch (err) {
    if (err instanceof MovementError) {
      return errorResponse(err.message, err.status)
    }
    console.error('[PATCH /api/inv/movements/[id]] 실패', err)
    return errorResponse('이동 기록 수정에 실패했습니다', 500)
  }
}

/**
 * reverseMovement의 반대 — 이동 효과를 stock에 가하기.
 * PATCH에서 원본 역산 후 새 quantity로 다시 적용할 때 사용.
 */
async function applyMovementEffect(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  spaceId: string,
  m: {
    type: string
    optionId: string
    locationId: string
    toLocationId: string | null
    quantity: number
  }
) {
  const { type, optionId, locationId, toLocationId, quantity } = m
  switch (type) {
    case 'INBOUND':
    case 'RETURN':
      await upsertDelta(tx, spaceId, optionId, locationId, quantity)
      return
    case 'OUTBOUND':
      await upsertDelta(tx, spaceId, optionId, locationId, -quantity)
      return
    case 'TRANSFER':
      if (!toLocationId) throw new MovementError('TRANSFER 적용 실패: toLocationId 누락', 500)
      await upsertDelta(tx, spaceId, optionId, locationId, -quantity)
      await upsertDelta(tx, spaceId, optionId, toLocationId, quantity)
      return
    case 'ADJUSTMENT':
      await upsertDelta(tx, spaceId, optionId, locationId, quantity)
      return
  }
}

async function upsertDelta(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  spaceId: string,
  optionId: string,
  locationId: string,
  delta: number
) {
  const existing = await tx.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  if (!existing) {
    await tx.invStockLevel.create({
      data: { spaceId, optionId, locationId, quantity: delta },
    })
  } else {
    await tx.invStockLevel.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + delta },
    })
  }
}
