import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { assertWorkerOwns, authenticateWorker } from '@/lib/worker-auth'
import { runInsightGeneration } from '@/lib/sc/insights'

const InputSchema = z.object({
  sinceDays: z.number().int().min(1).max(365).optional(),
  maxProposals: z.number().int().min(1).max(8).optional(),
})

async function resolveSpaceId(
  req: NextRequest
): Promise<{ spaceId: string } | { error: NextResponse }> {
  // 1) 워커 경로: x-worker-api-key(+ x-workspace-id 헤더 — 실제로는 spaceId). 헤더가 있으면 세션으로 폴백하지 않는다.
  //    Space 토큰이면 헤더가 없어도 토큰의 Space 를 쓰고, 헤더가 다르면 403.
  if (req.headers.get('x-worker-api-key')) {
    const workerAuth = await authenticateWorker(req.headers)
    if ('error' in workerAuth) return { error: workerAuth.error }
    const headerSpaceId = req.headers.get('x-workspace-id')
    const spaceId = workerAuth.scope.kind === 'space' ? workerAuth.scope.spaceId : headerSpaceId
    if (!spaceId) return { error: errorResponse('x-workspace-id 헤더가 필요합니다', 400) }
    const denied = assertWorkerOwns(workerAuth.scope, { spaceId: headerSpaceId ?? spaceId })
    if (denied) return { error: denied }
    return { spaceId }
  }
  // 2) 세션 경로: Deck 활성 공간 컨텍스트 — POST 전용 보조 함수라 쓰기 가드(구독 만료 402)
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved && resolved.error) return { error: resolved.error }
  if ('space' in resolved) return { spaceId: resolved.space.id }
  return { error: errorResponse('공간을 찾을 수 없습니다', 404) }
}

export async function POST(req: NextRequest) {
  const ctx = await resolveSpaceId(req)
  if ('error' in ctx) return ctx.error

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // body 없이 호출 허용 — 기본값 사용
    body = {}
  }
  const parsed = InputSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const result = await runInsightGeneration({
      spaceId: ctx.spaceId,
      sinceDays: parsed.data.sinceDays,
      maxProposals: parsed.data.maxProposals,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 규칙 생성 실패'
    const isProviderError = /not configured|구성되지 않|사용 가능한.*공급자가 구성되지/i.test(
      message
    )
    return errorResponse(message, isProviderError ? 503 : 500)
  }
}
