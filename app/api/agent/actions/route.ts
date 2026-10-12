/**
 * /api/agent/actions
 *  GET  — 승인 큐 목록 (status/deck 필터, lazy expire 후 반환). 호출자 Space 스코프.
 *  POST — 액션 생성 (세션 또는 x-worker-api-key). createPendingAction 경유.
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestedSpaceContext, errorResponse } from '@/lib/api-helpers'
import { assertWorkerOwns, authenticateWorker } from '@/lib/worker-auth'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '@/lib/agent/actions/create'
import { expirePendingActions } from '@/lib/agent/actions/execute'
import { describeActors } from '@/lib/agent/actions/actor-label'
import type { Actor } from '@/lib/agent/identity/principal'
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
  const resolved = await resolveRequestedSpaceContext(req.nextUrl.searchParams.get('spaceId'))
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

  // 행위자·요청자는 사람이 읽는 이름으로 — id(cuid)를 UI에 그대로 보이지 않는다.
  const labels = await describeActors(rows)
  return NextResponse.json({
    actions: rows.map((r, i) => ({ ...r, actorLabel: labels[i] })),
    role: resolved.role, // 선택한 Space에서의 역할 — 승인 목록의 canDecide
  })
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

  let actor: Actor
  let requesterUserId: string | null = null
  let resolvedSpaceId: string
  let resolvedSource: 'MCP' | 'WORKDECK_AGENT' | 'WEB' | 'SYSTEM'

  // 인증: 워커 토큰(헤더가 있으면 워커 경로 — 실패 시 401) 또는 세션.
  if (req.headers.get('x-worker-api-key')) {
    const worker = await authenticateWorker(req.headers)
    if ('error' in worker) return worker.error
    if (!spaceId) return errorResponse('spaceId가 필요합니다', 400)
    const denied = assertWorkerOwns(worker.scope, { spaceId })
    if (denied) return denied
    const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } })
    if (!space) return errorResponse('공간을 찾을 수 없습니다', 404)
    resolvedSpaceId = spaceId
    actor = { type: 'system', id: 'worker' }
    resolvedSource = source === 'WORKDECK_AGENT' || source === 'SYSTEM' ? source : 'SYSTEM'
  } else {
    // 세션 요청자는 자신이 속한 space에만 액션을 만들 수 있다(멤버십 검증, 아니면 403).
    const resolved = await resolveRequestedSpaceContext(
      req.nextUrl.searchParams.get('spaceId') ?? (typeof spaceId === 'string' ? spaceId : null)
    )
    if ('error' in resolved) return resolved.error
    resolvedSpaceId = resolved.space.id
    actor = { type: 'user', id: resolved.user.id }
    requesterUserId = resolved.user.id
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
      actor,
      requesterUserId,
      idempotencyKey,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : '액션 생성 실패'
    return errorResponse(message, 400)
  }
}
