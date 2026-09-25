import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext } from '@/lib/api-helpers'
import { parseYmdDateKst } from '@/lib/date-range'
import { prisma } from '@/lib/prisma'

type BatchWithOrderCount = Prisma.DelBatchGetPayload<{
  include: { _count: { select: { orders: true } } }
}>

function toBatchResponse(batch: BatchWithOrderCount) {
  return {
    id: batch.id,
    status: batch.status,
    source: batch.source,
    label: batch.label,
    orderCount: batch._count.orders,
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
  }
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const status = req.nextUrl.searchParams.get('status')
  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const pageSize = Math.min(
    100,
    Math.max(1, Number(req.nextUrl.searchParams.get('pageSize')) || 20)
  )

  const where: Prisma.DelBatchWhereInput = { spaceId: resolved.space.id }
  if (status === 'DRAFT' || status === 'COMPLETED') where.status = status

  if (from !== null || to !== null) {
    const fromDate = from === null ? null : parseYmdDateKst(from)
    const toDate = to === null ? null : parseYmdDateKst(to)
    if (!fromDate || !toDate || fromDate > toDate) {
      return NextResponse.json({ error: '유효한 완료일 기간이 필요합니다.' }, { status: 400 })
    }

    const data = await prisma.delBatch.findMany({
      where: {
        ...where,
        completedAt: {
          gte: fromDate,
          lt: new Date(toDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { completedAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    })

    return NextResponse.json({
      data: data.map(toBatchResponse),
      total: data.length,
      page: 1,
      pageSize: data.length,
    })
  }

  const [data, total] = await Promise.all([
    prisma.delBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { orders: true } } },
    }),
    prisma.delBatch.count({ where }),
  ])

  return NextResponse.json({
    data: data.map(toBatchResponse),
    total,
    page,
    pageSize,
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const label = typeof body?.label === 'string' ? body.label.trim() || null : null

  const batch = await prisma.delBatch.create({
    data: { spaceId: resolved.space.id, label },
  })

  return NextResponse.json({ batch }, { status: 201 })
}
