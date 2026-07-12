import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { parseKeywordQuery } from '@/lib/coupang-ads/keyword-query'
import { queryInefficientKeywords } from '@/lib/coupang-ads/queries'

// GET /api/campaigns/[campaignId]/inefficient-keywords
// 캠페인 키워드 집계 (기본: 전체, filter 파라미터로 필터링 가능)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const { searchParams } = request.nextUrl

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const adType = searchParams.get('adType')
  const query = parseKeywordQuery(searchParams)

  return NextResponse.json(
    await queryInefficientKeywords(workspace.id, campaignId, { from, to, adType, query })
  )
}
