import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { queryProductOptions } from '@/lib/sh/product-options-query'

// SKU/옵션 단위 조회 API — 조회 로직은 src/lib/sh/product-options-query.ts (route·MCP tool 공유).
// searchParams: productId, productIds(콤마), q, page, pageSize, offset, includeInactive

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const productIdsRaw = searchParams.get('productIds')

  return NextResponse.json(
    await queryProductOptions(resolved.space.id, {
      productId: searchParams.get('productId'),
      productIds: productIdsRaw ? productIdsRaw.split(',').filter(Boolean) : null,
      q: searchParams.get('q'),
      page: searchParams.get('page') ? Number(searchParams.get('page')) : null,
      pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : null,
      offset: searchParams.get('offset') ? Number(searchParams.get('offset')) : null,
      includeInactive: searchParams.get('includeInactive') === 'true',
    })
  )
}
