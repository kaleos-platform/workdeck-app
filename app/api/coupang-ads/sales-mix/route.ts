import { measureCoupangAds, withCoupangAdsTiming } from '@/lib/coupang-ads/server-timing'
import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { isYmdDateString } from '@/lib/date-range'
import { querySalesMix, querySalesMixProductDetail } from '@/lib/coupang-ads/sales-mix-query'

// GET /api/coupang-ads/sales-mix?startDate&endDate[&productId]
export async function GET(request: NextRequest) {
  return withCoupangAdsTiming(async () => {
    const resolved = await measureCoupangAds('auth', resolveWorkspace)
    if (resolved.error) return resolved.error
    const { workspace } = resolved

    const { searchParams } = request.nextUrl
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const productId = searchParams.get('productId')

    if (!startDate || !endDate || !isYmdDateString(startDate) || !isYmdDateString(endDate)) {
      return errorResponse('startDate, endDate 파라미터가 필요합니다 (YYYY-MM-DD)', 400)
    }

    if (startDate > endDate) return errorResponse('startDate 가 endDate 보다 늦습니다', 400)

    return NextResponse.json(
      await measureCoupangAds<unknown>('data', () =>
        productId
          ? querySalesMixProductDetail(workspace.id, { startDate, endDate, productId })
          : querySalesMix(workspace.id, { startDate, endDate })
      )
    )
  })
}
