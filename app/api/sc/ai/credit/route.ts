import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { getMonthUsage } from '@/lib/ai/credit'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const usage = await getMonthUsage(resolved.space.id)
  return NextResponse.json(usage)
}
