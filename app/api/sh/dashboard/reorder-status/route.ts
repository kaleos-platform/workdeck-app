import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { queryReorderStatus } from '@/lib/sh/queries'

// 홈 대시보드 "발주 계획" 카드 — 초안 발주 + 예측 검증 결과.
// 조회 로직은 src/lib/sh/queries.ts 로 이동(route·MCP tool 공유).

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  return NextResponse.json(await queryReorderStatus(resolved.space.id))
}
