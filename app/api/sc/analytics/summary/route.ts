import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getSpaceAnalyticsSummary } from '@/lib/sc/metrics'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const summary = await getSpaceAnalyticsSummary(resolved.space.id)
  return NextResponse.json(summary)
}
