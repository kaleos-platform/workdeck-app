import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const status = req.nextUrl.searchParams.get('status')
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize')) || 20))

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (status === 'DRAFT' || status === 'COMPLETED') where.status = status

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
    data: data.map((b) => ({
      id: b.id,
      status: b.status,
      label: b.label,
      orderCount: b._count.orders,
      createdAt: b.createdAt,
      completedAt: b.completedAt,
    })),
    total,
    page,
    pageSize,
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const label = typeof body?.label === 'string' ? body.label.trim() || null : null

  const batch = await prisma.delBatch.create({
    data: { spaceId: resolved.space.id, label },
  })

  return NextResponse.json({ batch }, { status: 201 })
}
