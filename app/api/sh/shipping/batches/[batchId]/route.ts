import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deleteBatchWithMovements } from '@/lib/sh/batch-delete'

type Params = { params: Promise<{ batchId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    include: { _count: { select: { orders: true } } },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  return NextResponse.json({
    batch: {
      id: batch.id,
      status: batch.status,
      label: batch.label,
      orderCount: batch._count.orders,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true, source: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))

  // 상태 변경: DRAFT → COMPLETED
  if (body?.status === 'COMPLETED') {
    if (batch.status !== 'DRAFT') {
      return errorResponse('이미 완료된 배송 묶음입니다', 400)
    }
    // 자동 라벨 생성
    const now = new Date()
    const hour = now.getHours()
    const ampm = hour < 12 ? '오전' : '오후'
    const autoLabel = `${now.toISOString().split('T')[0]} ${ampm}`
    const label =
      typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : autoLabel

    const spaceId = resolved.space.id
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.delBatch.update({
        where: { id: batchId },
        data: { status: 'COMPLETED', completedAt: now, label },
      })

      // 채널 재고 차감 — MANUAL 배치만. IMPORT(이력 이전) 배치는 과거 데이터이므로 차감 제외.
      if (batch.source === 'MANUAL') {
        // listingId 매칭된 출고 라인만 차감 가능 (optionId/미매칭은 대상 listing 결정 불가)
        const items = await tx.delOrderItem.findMany({
          where: { listingId: { not: null }, order: { batchId } },
          select: { id: true, listingId: true, quantity: true },
        })

        if (items.length > 0) {
          // 멱등성: 이미 이 배치로 차감된 orderItem은 제외 (재완료 안전)
          const existing = await tx.channelStockMovement.findMany({
            where: { batchId },
            select: { orderItemId: true },
          })
          const done = new Set(existing.map((e) => e.orderItemId))
          const fresh = items.filter((i) => !done.has(i.id))

          if (fresh.length > 0) {
            // channelStock이 설정된(non-null) listing만 차감 대상 (null = 기능 off)
            const listingIds = [...new Set(fresh.map((i) => i.listingId!))]
            const enabledRows = await tx.productListing.findMany({
              where: { id: { in: listingIds }, channelStock: { not: null } },
              select: { id: true },
            })
            const enabled = new Set(enabledRows.map((l) => l.id))
            const decrementable = fresh.filter((i) => enabled.has(i.listingId!))

            if (decrementable.length > 0) {
              // 원장 기록 (출고 라인당 1행, 차감량 = DelOrderItem.quantity 세트 단위)
              await tx.channelStockMovement.createMany({
                data: decrementable.map((i) => ({
                  spaceId,
                  listingId: i.listingId!,
                  batchId,
                  orderItemId: i.id,
                  quantity: i.quantity,
                })),
              })
              // listing별 합산 후 원자적 차감
              const byListing = new Map<string, number>()
              for (const i of decrementable) {
                byListing.set(i.listingId!, (byListing.get(i.listingId!) ?? 0) + i.quantity)
              }
              for (const [lid, n] of byListing) {
                await tx.productListing.update({
                  where: { id: lid },
                  data: { channelStock: { decrement: n } },
                })
              }
            }
          }
        }
      }

      return b
    })
    return NextResponse.json({ batch: updated })
  }

  // 라벨 수정
  const data: Record<string, unknown> = {}
  if (typeof body?.label === 'string') data.label = body.label.trim() || null
  if (Object.keys(data).length === 0) return errorResponse('변경할 내용이 없습니다', 400)

  const updated = await prisma.delBatch.update({ where: { id: batchId }, data })
  return NextResponse.json({ batch: updated })
}

// DELETE — 배송 묶음 + 주문 + 연동 InvMovement(이력 이전 OUTBOUND) 함께 삭제.
// DRAFT/COMPLETED 모두 허용. 실수 방지 확인은 UI(label 타이핑)에서 담당.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  try {
    const { deletedMovements } = await deleteBatchWithMovements(resolved.space.id, batchId)
    return NextResponse.json({ success: true, deletedMovements })
  } catch (err) {
    console.error('[DELETE /api/sh/shipping/batches/[batchId]] 실패', err)
    return errorResponse('배송 묶음 삭제에 실패했습니다', 500)
  }
}
