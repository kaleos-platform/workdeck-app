import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { queryProductRanking } from '@/lib/sh/queries'

// 홈 대시보드 "상품 현황" 카드 — 최근 30일 주문건수 기준 상위/부진 상품.
// 조회 로직은 src/lib/sh/queries.ts 로 이동(route·MCP tool 공유).

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  return NextResponse.json(await queryProductRanking(resolved.space.id))
}
