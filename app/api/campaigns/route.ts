import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { queryCampaigns } from '@/lib/coupang-ads/queries'

// GET /api/campaigns — 워크스페이스 내 캠페인 목록 (displayName 포함)
// startDate, endDate 파라미터 제공 시 캠페인별 기간 지표 + 이전 동일 기간 지표 포함
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('startDate') ?? undefined
  const endDate = searchParams.get('endDate') ?? undefined

  return NextResponse.json(await queryCampaigns(workspace.id, { startDate, endDate }))
}
