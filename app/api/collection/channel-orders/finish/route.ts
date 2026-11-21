/** POST — 워커 실행 마감. OBSERVE 는 전체 성공 + lease 소유일 때만 커서 전진(오래된 finish 는 409). */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errorResponse } from '@/lib/api-helpers'
import { finishFullScan, finishObserve } from '@/lib/channel-orders/operations'
import {
  channelOrderErrorResponse,
  loadOwnedOperation,
  resolveWorkerSpace,
} from '@/lib/channel-orders/worker-route'

const Observe = z.object({
  operationId: z.string().min(1),
  success: z.boolean(),
  through: z.iso.datetime({ offset: true }).optional(),
  pagesRequested: z.number().int().min(0).optional(),
  pagesIngested: z.number().int().min(0).optional(),
  rows: z.number().int().min(0).optional(),
  errorCode: z.string().max(40).optional(),
})
const Scan = z.object({
  operationId: z.string().min(1),
  success: z.boolean(),
  periodFrom: z.iso.datetime({ offset: true }),
  periodTo: z.iso.datetime({ offset: true }),
  pagesRequested: z.number().int().min(0),
  pagesReceived: z.number().int().min(0),
  structureOk: z.boolean(),
  errorCode: z.string().max(40).optional(),
})

export async function POST(request: NextRequest) {
  const resolved = await resolveWorkerSpace(request.headers)
  if ('error' in resolved) return resolved.error
  const body = await request.json().catch(() => null)
  const id = z.object({ operationId: z.string().min(1) }).safeParse(body)
  if (!id.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const op = await loadOwnedOperation(resolved.scope.spaceId, id.data.operationId)
  if (!op) return errorResponse('operation 을 찾을 수 없습니다', 404)
  try {
    if (op.kind === 'FULL_SCAN') {
      const p = Scan.safeParse(body)
      if (!p.success) return errorResponse('입력값이 올바르지 않습니다', 400)
      const r = await finishFullScan(p.data, new Date())
      return r.accepted
        ? NextResponse.json(r)
        : errorResponse('만료되었거나 이미 마감된 operation 입니다', 409)
    }
    const p = Observe.safeParse(body)
    if (op.kind !== 'OBSERVE' || !p.success) return errorResponse('입력값이 올바르지 않습니다', 400)
    const r = await finishObserve(p.data, new Date())
    return r.accepted
      ? NextResponse.json(r)
      : errorResponse('만료되었거나 이미 마감된 operation 입니다', 409)
  } catch (err) {
    return channelOrderErrorResponse(err)
  }
}
