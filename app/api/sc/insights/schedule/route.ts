import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { assertWorkerOwns, authenticateWorker } from '@/lib/worker-auth'
import { scheduleInsightSweep } from '@/lib/sc/insight-scheduler'

const InputSchema = z.object({
  sinceDays: z.number().int().min(1).max(365).optional(),
  maxProposals: z.number().int().min(1).max(8).optional(),
  skipIfRecentHours: z.number().int().min(0).max(168).optional(),
  allSpaces: z.boolean().optional(), // 워커 인증에서만 허용
})

export async function POST(req: NextRequest) {
  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = InputSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 세션 인증: 현재 Space 만 대상. 워커 헤더가 있으면 세션으로 폴백하지 않는다(틀린 키는 401).
  if (!req.headers.get('x-worker-api-key')) {
    const resolved = await resolveDeckContext('sales-content', { write: true })
    if ('error' in resolved) return resolved.error
    const result = await scheduleInsightSweep({
      spaceId: resolved.space.id,
      sinceDays: parsed.data.sinceDays,
      maxProposals: parsed.data.maxProposals,
      skipIfRecentHours: parsed.data.skipIfRecentHours,
    })
    return NextResponse.json(result)
  }

  const workerAuth = await authenticateWorker(req.headers)
  if ('error' in workerAuth) return workerAuth.error

  // 워커 인증: allSpaces=true 면 전체 스윕, 아니면 x-workspace-id 지정 공간만.
  // Space 토큰은 allSpaces 를 무시하고 토큰의 Space 만 처리한다.
  if (parsed.data.allSpaces && workerAuth.scope.kind === 'legacy') {
    const result = await scheduleInsightSweep({
      sinceDays: parsed.data.sinceDays,
      maxProposals: parsed.data.maxProposals,
      skipIfRecentHours: parsed.data.skipIfRecentHours,
    })
    return NextResponse.json(result)
  }

  const headerSpaceId = req.headers.get('x-workspace-id')
  const spaceId = workerAuth.scope.kind === 'space' ? workerAuth.scope.spaceId : headerSpaceId
  if (!spaceId) return errorResponse('x-workspace-id 또는 allSpaces=true 가 필요합니다', 400)
  const denied = assertWorkerOwns(workerAuth.scope, { spaceId: headerSpaceId ?? spaceId })
  if (denied) return denied
  const result = await scheduleInsightSweep({
    spaceId,
    sinceDays: parsed.data.sinceDays,
    maxProposals: parsed.data.maxProposals,
    skipIfRecentHours: parsed.data.skipIfRecentHours,
  })
  return NextResponse.json(result)
}
