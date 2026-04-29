import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { runInsightGeneration } from '@/lib/sc/insights'

const InputSchema = z.object({
  sinceDays: z.number().int().min(1).max(365).optional(),
  maxProposals: z.number().int().min(1).max(8).optional(),
})

async function resolveSpaceId(
  req: NextRequest
): Promise<{ spaceId: string } | { error: NextResponse }> {
  // 1) 워커 경로: x-worker-api-key + x-workspace-id 헤더
  const workerAuth = resolveWorkerAuth(req)
  if (!('error' in workerAuth)) {
    const spaceId = req.headers.get('x-workspace-id')
    if (!spaceId) return { error: errorResponse('x-workspace-id 헤더가 필요합니다', 400) }
    return { spaceId }
  }
  // 2) 세션 경로: Deck 활성 공간 컨텍스트
  const resolved = await resolveDeckContext('sales-content')
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
