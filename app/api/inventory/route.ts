import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const search = searchParams.get('search') ?? ''
  const sortBy = searchParams.get('sortBy') ?? 'productName'
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' as const : 'asc' as const
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? 50)))
  const snapshotDate = searchParams.get('snapshotDate')

  // 최신 스냅샷 날짜 결정
  let targetDate: Date | undefined
  if (snapshotDate) {
    targetDate = new Date(snapshotDate)
  } else {
    const latest = await prisma.inventoryUpload.findFirst({
      where: { workspaceId: resolved.workspace.id },
      orderBy: { snapshotDate: 'desc' },
      select: { snapshotDate: true },
    })
    targetDate = latest?.snapshotDate
  }

  if (!targetDate) {
    return NextResponse.json({ records: [], total: 0, snapshotDate: null })
  }

  const where = {
    workspaceId: resolved.workspace.id,
    snapshotDate: targetDate,
    ...(search ? { productName: { contains: search, mode: 'insensitive' as const } } : {}),
  }

  const allowedSorts = ['productName', 'availableStock', 'revenue30d', 'salesQty30d', 'storageFee', 'conversionRate']
  const orderField = allowedSorts.includes(sortBy) ? sortBy : 'productName'

  const [records, total] = await Promise.all([
    prisma.inventoryRecord.findMany({
      where,
      orderBy: { [orderField]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryRecord.count({ where }),
  ])

  return NextResponse.json({
    records,
    total,
    page,
    limit,
    snapshotDate: targetDate.toISOString(),
  })
}
