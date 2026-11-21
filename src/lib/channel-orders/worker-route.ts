// 워커용 채널 주문 관측 API 공통: Space 워커 토큰 → operation 소유 Space 확인, 오류 → 응답 변환.
import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveNbaesongScope } from '@/lib/naver-commerce/worker-api'
import { ChannelOrderError } from './types'

export { resolveNbaesongScope as resolveWorkerSpace }

export async function loadOwnedOperation(spaceId: string, operationId: string) {
  const op = await prisma.pipelineOperation.findUnique({
    where: { id: operationId },
    select: { id: true, spaceId: true, kind: true },
  })
  // 다른 Space 의 operation 은 존재 여부를 드러내지 않는다.
  return op && op.spaceId === spaceId ? op : null
}

export function channelOrderErrorResponse(err: unknown): NextResponse {
  if (err instanceof ChannelOrderError) {
    const status = { lease_lost: 409, busy: 409, not_found: 404, invalid: 400 }[err.code]
    return errorResponse(err.message, status)
  }
  throw err
}
