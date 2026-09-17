import { measureCoupangAds, withCoupangAdsTiming } from '@/lib/coupang-ads/server-timing'
import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { queryCampaigns, queryCampaignNavigation } from '@/lib/coupang-ads/queries'

// GET /api/campaigns — 워크스페이스 내 캠페인 목록 (displayName 포함)
// startDate, endDate 파라미터 제공 시 캠페인별 기간 지표 + 이전 동일 기간 지표 포함
export async function GET(request: NextRequest) {
  return withCoupangAdsTiming(async () => {
    const resolved = await measureCoupangAds('auth', resolveWorkspace)
    if (resolved.error) return resolved.error
    const { workspace } = resolved

    const { searchParams } = request.nextUrl
    if (searchParams.get('view') === 'navigation') {
      return NextResponse.json(
        await measureCoupangAds('data', () => queryCampaignNavigation(workspace.id))
      )
    }
    const startDate = searchParams.get('startDate') ?? undefined
    const endDate = searchParams.get('endDate') ?? undefined

    return NextResponse.json(
      await measureCoupangAds('data', () => queryCampaigns(workspace.id, { startDate, endDate }))
    )
  })
}
