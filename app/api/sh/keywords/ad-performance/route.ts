import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { loadAdKeywordPerformance } from '@/lib/sh/ad-keyword-performance-query'

/** 채널상품/리스팅의 최근 30일 쿠팡 광고 검색어 성과(읽기 전용). */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const channelProductId = searchParams.get('channelProductId')?.trim() || undefined
  const listingId = searchParams.get('listingId')?.trim() || undefined
  if (!channelProductId && !listingId) {
    return NextResponse.json(
      { error: 'channelProductId 또는 listingId 가 필요합니다' },
      { status: 400 }
    )
  }

  const result = await loadAdKeywordPerformance(resolved.space.id, { channelProductId, listingId })
  if (!result) return NextResponse.json({ error: '대상을 찾을 수 없습니다' }, { status: 404 })
  return NextResponse.json(result)
}
