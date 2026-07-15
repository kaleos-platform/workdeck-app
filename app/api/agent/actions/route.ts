/**
 * /api/agent/actions
 *  GET  — 승인 큐 목록 (status/deck 필터, lazy expire 후 반환). 호출자 Space 스코프.
 *  POST — 액션 생성 (세션 또는 x-worker-api-key). createPendingAction 경유.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveSpaceContext, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '@/lib/agent/actions/create'
import { expirePendingActions } from '@/lib/agent/actions/execute'
import type { AgentActionStatus } from '@/generated/prisma/enums'

const VALID_STATUS: AgentActionStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
  'FAILED',
  'EXPIRED',
]

export async function GET(req: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  // 조회 전 만료 처리 — 목록에 stale PENDING이 남지 않도록.
  await expirePendingActions()

  const sp = req.nextUrl.searchParams
  const statusParam = sp.get('status')
  const deckKey = sp.get('deck')

  const rows = await prisma.agentPendingAction.findMany({
    where: {
      spaceId,
      ...(statusParam && VALID_STATUS.includes(statusParam as AgentActionStatus)
        ? { status: statusParam as AgentActionStatus }
        : {}),
      ...(deckKey ? { deckKey } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({ actions: rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { spaceId, actionType, params, summary, source, idempotencyKey } = body as {
    spaceId?: string
    actionType?: string
    params?: unknown
    summary?: string
    source?: string
    idempotencyKey?: string
  }

  // 인증: 워커 키 또는 세션. 워커면 body.spaceId 신뢰, 세션이면 멤버십 검증.
  const worker = resolveWorkerAuth(req)
  let requestedBy: string
  let resolvedSpaceId: string
  let resolvedSource: 'MCP' | 'WORKDECK_AGENT' | 'WEB' | 'SYSTEM'

  if ('authenticated' in worker) {
    if (!spaceId) return errorResponse('spaceId가 필요합니다', 400)
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } })
    if (!space) return errorResponse('공간을 찾을 수 없습니다', 404)
    resolvedSpaceId = spaceId
    requestedBy = 'worker'
    resolvedSource = source === 'WORKDECK_AGENT' || source === 'SYSTEM' ? source : 'SYSTEM'
  } else {
    const resolved = await resolveSpaceContext()
    if ('error' in resolved) return resolved.error
    // 세션 요청자는 자신이 속한 space에만 액션을 만들 수 있다.
    if (spaceId && spaceId !== resolved.space.id) {
      return errorResponse('다른 공간에 액션을 만들 수 없습니다', 403)
    }
    resolvedSpaceId = resolved.space.id
    requestedBy = resolved.user.id
    resolvedSource = source === 'WEB' ? 'WEB' : 'MCP'
  }

  if (!actionType || typeof actionType !== 'string') {
    return errorResponse('actionType이 필요합니다', 400)
  }
  if (!summary || typeof summary !== 'string') {
    return errorResponse('summary가 필요합니다', 400)
  }

  try {
    const result = await createPendingAction({
      spaceId: resolvedSpaceId,
      actionType,
      params,
      summary,
      source: resolvedSource,
      requestedBy,
      idempotencyKey,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '액션 생성 실패'
    return errorResponse(message, 400)
  }
}
