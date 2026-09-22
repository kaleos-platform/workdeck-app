import { NextRequest, NextResponse } from 'next/server'
import { queryCampaignTargetSummary } from '@/lib/coupang-ads/target-summary'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/targets/summary
// 기간 내 일 예산 평균 소진율 & 목표 ROAS 평균 달성율 계산
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

  if (!from || !to) {
    return NextResponse.json({ budgetUtilization: null, roasAchievement: null })
  }

  return NextResponse.json(await queryCampaignTargetSummary(workspace.id, campaignId, from, to))
}
