import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { queryProductMargin } from '@/lib/sh/margin-query'

// SKU/옵션 단위 공헌이익 API — 집계 로직은 src/lib/sh/margin-query.ts (route·MCP tool 공유).
// searchParams: from, to (필수, YYYY-MM-DD KST), productIds/optionIds(콤마), channel, page, pageSize,
//   excludeGroups(콤마) — 생략 시 판매분석 랭킹과 같은 기본값(체험단·부자재 제외), 빈 값이면 제외 없음

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) {
    return NextResponse.json({ error: 'from·to는 필수입니다 (YYYY-MM-DD)' }, { status: 400 })
  }

  const list = (key: string) => {
    const raw = searchParams.get(key)
    return raw ? raw.split(',').filter(Boolean) : null
  }

  return NextResponse.json(
    await queryProductMargin(resolved.space.id, {
      from,
      to,
      productIds: list('productIds'),
      optionIds: list('optionIds'),
      channel: searchParams.get('channel'),
      page: searchParams.get('page') ? Number(searchParams.get('page')) : null,
      pageSize: searchParams.get('pageSize') ? Number(searchParams.get('pageSize')) : null,
      // has() 로 구분: 파라미터 자체가 없으면 기본값, `excludeGroups=` 처럼 비어 있으면 제외 없음
      excludeProductGroupNames: searchParams.has('excludeGroups')
        ? (searchParams.get('excludeGroups') ?? '').split(',').filter(Boolean)
        : null,
    })
  )
}
