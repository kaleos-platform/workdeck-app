import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { getContentsCompareData } from '@/lib/sc/metrics'

/**
 * GET /api/sc/analytics/compare?ids=a,b,c&days=30
 * 콘텐츠 비교 데이터 반환. 2~5개 id, 같은 space 에 속해야 함.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { searchParams } = request.nextUrl
  const idsParam = searchParams.get('ids')
  const daysParam = searchParams.get('days')

  if (!idsParam) {
    return errorResponse('ids 파라미터가 필요합니다', 400)
  }

  const contentIds = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

  if (contentIds.length < 2 || contentIds.length > 5) {
    return errorResponse('콘텐츠는 2~5개를 선택해야 합니다', 400)
  }

  const daysBack = daysParam ? Math.min(Math.max(parseInt(daysParam, 10) || 30, 7), 90) : 30

  try {
    const data = await getContentsCompareData(resolved.space.id, contentIds, daysBack)
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : '비교 데이터 조회 실패'
    // 권한/존재 오류는 403, 나머지는 500
    const status = message.includes('접근 권한') ? 403 : 500
    return errorResponse(message, status)
  }
}
