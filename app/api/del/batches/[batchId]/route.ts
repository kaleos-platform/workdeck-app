import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ batchId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    include: { _count: { select: { orders: true } } },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배치를 찾을 수 없습니다', 404)
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
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배치를 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))

  // 상태 변경: DRAFT → COMPLETED
  if (body?.status === 'COMPLETED') {
    if (batch.status !== 'DRAFT') {
      return errorResponse('이미 완료된 배치입니다', 400)
    }
    const updated = await prisma.delBatch.update({
      where: { id: batchId },
      data: { status: 'COMPLETED', completedAt: new Date() },
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
