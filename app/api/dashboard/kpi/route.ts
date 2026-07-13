import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { queryKpi } from '@/lib/coupang-ads/queries'

// GET /api/dashboard/kpi?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// 선택 기간 집계 KPI 5개 + 이전 동일 기간 대비 증감율 반환
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return errorResponse('startDate, endDate 파라미터가 필요합니다', 400)
  }

  return NextResponse.json(await queryKpi(workspace.id, { startDate, endDate }))
}
