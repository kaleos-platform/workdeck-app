import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { loadOptionDemand } from '@/lib/inv/option-demand'

// 판매분석 "상품(옵션)" 탭 — 일자×내부옵션×채널 판매량(수량) 집계.
// 집계 본체는 loadOptionDemand 가 담당 (발주 예측과 공유하는 단일 수요 소스).
// 이 라우트는 채널 해석(활성·필터) + 응답 직렬화만 한다.

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const channelIdsParam = searchParams.get('channelIds')

  // groupBy 계약 명시 — 현재 'date' 단위만 지원. 다른 값이 오면 400.
  const groupBy = searchParams.get('groupBy') ?? 'date'
  if (groupBy !== 'date') {
    return errorResponse('지원하지 않는 groupBy 입니다 (현재 date만 지원)', 400)
  }

  if (!fromParam || !toParam) {
    return errorResponse('from, to 쿼리 파라미터가 필요합니다', 400)
  }

  const from = new Date(fromParam)
  const to = new Date(toParam)
  to.setHours(23, 59, 59, 999)

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return errorResponse('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)', 400)
  }
  if (from > to) {
    return errorResponse('from이 to보다 이후일 수 없습니다', 400)
  }

  const channelIds = channelIdsParam
    ? channelIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined

  const channels = await prisma.channel.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(channelIds && channelIds.length > 0 ? { id: { in: channelIds } } : {}),
      isActive: true,
    },
    select: { id: true, name: true, externalSource: true },
    orderBy: { name: 'asc' },
  })

  if (channels.length === 0) {
    return NextResponse.json({ period: { from: fromParam, to: toParam }, rows: [] })
  }

  const rows = await loadOptionDemand(resolved.space.id, from, to, channels)

  return NextResponse.json({ period: { from: fromParam, to: toParam }, rows })
}
