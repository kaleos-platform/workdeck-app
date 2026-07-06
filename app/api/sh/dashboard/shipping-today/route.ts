import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getTodayStrKst } from '@/lib/date-range'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  // KST 기준 오늘 00:00:00 ~ 23:59:59 범위 계산
  const todayStr = getTodayStrKst()
  const todayStart = new Date(todayStr + 'T00:00:00+09:00')
  const todayEnd = new Date(todayStr + 'T23:59:59+09:00')

  const [draftBatches, completedTodayCount] = await Promise.all([
    // 오늘 생성된 DRAFT 배치 + 주문 수
    prisma.delBatch.findMany({
      where: {
        spaceId,
        status: 'DRAFT',
        createdAt: { gte: todayStart, lte: todayEnd },
      },
      include: { _count: { select: { orders: true } } },
    }),
    // 오늘 완료된 배치 수
    prisma.delBatch.count({
      where: {
        spaceId,
        status: 'COMPLETED',
        completedAt: { gte: todayStart, lte: todayEnd },
      },
    }),
  ])

  const draftBatchCount = draftBatches.length
  const draftOrderCount = draftBatches.reduce((sum, b) => sum + b._count.orders, 0)

  return NextResponse.json({ draftBatchCount, draftOrderCount, completedTodayCount })
}
