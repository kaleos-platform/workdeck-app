import { NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { loadMatchingRows } from '@/lib/sh/coupang-price/load-matching'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  return NextResponse.json({ rows: await loadMatchingRows(resolved.space.id) })
}
