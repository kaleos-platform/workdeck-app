import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { queryStockStatus } from '@/lib/sh/queries'

// 재고 현황 API — 조회 로직은 src/lib/sh/queries.ts 로 이동(route·MCP tool 공유).
// searchParams: brandId, groupId, productId, q, onlyLow — matrix.rows에만 적용.

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const onlyLow = searchParams.get('onlyLow') === '1' || searchParams.get('onlyLow') === 'true'

  return NextResponse.json(
    await queryStockStatus(resolved.space.id, {
      brandId: searchParams.get('brandId'),
      groupId: searchParams.get('groupId'),
      productId: searchParams.get('productId'),
      q: searchParams.get('q'),
      onlyLow,
    })
  )
}
