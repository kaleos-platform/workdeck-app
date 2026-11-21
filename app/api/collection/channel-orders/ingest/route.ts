/** POST — 워커가 읽은 주문 행 적재. OBSERVE 는 lease 소유 확인(아니면 409), FULL_SCAN 은 전수 조회 행. 개인정보 필드는 400. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { ingestLines, ingestScanLines } from '@/lib/channel-orders/ingest'
import { MAX_INGEST_LINES } from '@/lib/channel-orders/types'
import {
  channelOrderErrorResponse,
  loadOwnedOperation,
  resolveWorkerSpace,
} from '@/lib/channel-orders/worker-route'

const BodySchema = z.object({
  operationId: z.string().min(1),
  lines: z.array(z.unknown()).max(MAX_INGEST_LINES),
})

export async function POST(request: NextRequest) {
  const resolved = await resolveWorkerSpace(request.headers)
  if ('error' in resolved) return resolved.error
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const op = await loadOwnedOperation(resolved.scope.spaceId, parsed.data.operationId)
  if (!op) return errorResponse('operation 을 찾을 수 없습니다', 404)
  try {
    if (op.kind === 'FULL_SCAN')
      return NextResponse.json(await ingestScanLines(op.id, parsed.data.lines))
    if (op.kind === 'OBSERVE') return NextResponse.json(await ingestLines(op.id, parsed.data.lines))
    return errorResponse('operation 종류가 올바르지 않습니다', 400)
  } catch (err) {
    return channelOrderErrorResponse(err)
  }
}
