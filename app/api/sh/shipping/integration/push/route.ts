import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { pushToInventoryDeck } from '@/lib/del/integration-processor'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const dateFrom = body?.dateFrom ? new Date(body.dateFrom) : null
  const dateTo = body?.dateTo ? new Date(body.dateTo) : null
  const locationId = typeof body?.locationId === 'string' ? body.locationId : ''

  if (!dateFrom || !dateTo) return errorResponse('dateFrom, dateTo가 필요합니다', 400)
  if (!locationId) return errorResponse('locationId가 필요합니다', 400)

  try {
    const result = await pushToInventoryDeck(resolved.space.id, dateFrom, dateTo, locationId)
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : '연동 실패', 500)
  }
}
