import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveWorkspace } from '@/lib/api-helpers'
import { isYmdDateString } from '@/lib/date-range'
import { getCachedCampaignOverview } from '@/lib/coupang-ads/campaign-overview'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const { campaignId } = await params
  const from = request.nextUrl.searchParams.get('from') ?? ''
  const to = request.nextUrl.searchParams.get('to') ?? ''
  const adType = request.nextUrl.searchParams.get('adType') ?? 'all'

  if (!isYmdDateString(from) || !isYmdDateString(to) || from > to) {
    return errorResponse('올바른 from, to 기간이 필요합니다', 400)
  }

  try {
    const overview = await getCachedCampaignOverview({
      workspaceId: resolved.workspace.id,
      campaignId,
      from,
      to,
      adType,
    })
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof Error && error.message === 'CAMPAIGN_NOT_FOUND') {
      return errorResponse('캠페인을 찾을 수 없습니다', 404)
    }
    return errorResponse('캠페인 상세 데이터를 불러오지 못했습니다', 500)
  }
}
