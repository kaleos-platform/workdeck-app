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
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
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
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim() : autoLabel

    const updated = await prisma.delBatch.update({
      where: { id: batchId },
      data: { status: 'COMPLETED', completedAt: now, label },
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
