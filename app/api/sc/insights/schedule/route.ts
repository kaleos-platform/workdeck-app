import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
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

  const workerAuth = resolveWorkerAuth(req)
  const isWorker = !('error' in workerAuth)

  // 세션 인증: 현재 Space 만 대상
  if (!isWorker) {
    const resolved = await resolveDeckContext('sales-content')
    if ('error' in resolved) return resolved.error
    const result = await scheduleInsightSweep({
      spaceId: resolved.space.id,
      sinceDays: parsed.data.sinceDays,
      maxProposals: parsed.data.maxProposals,
      skipIfRecentHours: parsed.data.skipIfRecentHours,
    })
    return NextResponse.json(result)
  }

  // 워커 인증: allSpaces=true 면 전체 스윕, 아니면 x-workspace-id 지정 공간만
  if (parsed.data.allSpaces) {
    const result = await scheduleInsightSweep({
      sinceDays: parsed.data.sinceDays,
      maxProposals: parsed.data.maxProposals,
      skipIfRecentHours: parsed.data.skipIfRecentHours,
    })
    return NextResponse.json(result)
  }

  const spaceId = req.headers.get('x-workspace-id')
  if (!spaceId) return errorResponse('x-workspace-id 또는 allSpaces=true 가 필요합니다', 400)
  const result = await scheduleInsightSweep({
    spaceId,
    sinceDays: parsed.data.sinceDays,
    maxProposals: parsed.data.maxProposals,
    skipIfRecentHours: parsed.data.skipIfRecentHours,
  })
  return NextResponse.json(result)
}
