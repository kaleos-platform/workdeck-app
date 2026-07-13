import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { querySalesSummary } from '@/lib/sh/queries'

// 홈 대시보드 "판매 요약" 카드 — 이번달(MTD) vs 지난달 동기간 매출·주문 + 최근 30일.
// 조회 로직은 src/lib/sh/queries.ts 로 이동(route·MCP tool 공유).

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  return NextResponse.json(await querySalesSummary(resolved.space.id))
}
