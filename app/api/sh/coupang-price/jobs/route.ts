import { NextRequest, NextResponse } from 'next/server'

import { errorResponse, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/sh/coupang-price/jobs?channelId= — 해당 채널 카드의 가장 최근 가격 반영 잡.
 * 다이얼로그가 반영 후 폴링하고, 다시 열었을 때 놓친 결과를 보여주는 유일한 경로다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const channelId = req.nextUrl.searchParams.get('channelId')
  if (!channelId) return errorResponse('channelId 가 필요합니다', 400)

  const job = await prisma.coupangWriteJob.findFirst({
    where: {
      spaceId: resolved.space.id,
      kind: 'PRICE_CHANGE',
      payload: { path: ['channelId'], equals: channelId },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      results: true,
      error: true,
      createdAt: true,
      executedAt: true,
      payload: true,
    },
  })
  if (!job) return NextResponse.json({ job: null })

  const payload = job.payload as {
    targets: Array<{
      listingId: string
      listingName: string
      targetPrice: number
      apMinSalePrice: number
    }>
  }
  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      results: job.results,
      error: job.error,
      createdAt: job.createdAt,
      executedAt: job.executedAt,
      targets: payload.targets.map((t) => ({
        listingId: t.listingId,
        listingName: t.listingName,
        targetPrice: t.targetPrice,
        apMinSalePrice: t.apMinSalePrice,
      })),
    },
  })
}
