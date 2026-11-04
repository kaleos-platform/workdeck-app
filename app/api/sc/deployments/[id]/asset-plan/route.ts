// PUT  /api/sc/deployments/[id]/asset-plan — 사진 자리 선택 저장(중간 저장)
// POST /api/sc/deployments/[id]/asset-plan — 저장 + 「사진 등록 완료」(모든 자리가 사진 또는 빼기여야 함) → 발행 예약

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { assetPlanSchema } from '@/lib/sc/aside-publish'
import { saveAssetPlan } from '@/lib/sc/asset-plan'

type Params = { params: Promise<{ id: string }> }

async function handle(req: NextRequest, { params }: Params, complete: boolean) {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error

  const parsed = assetPlanSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('사진 자리 정보가 올바르지 않습니다', 400)

  const { id } = await params
  const result = await saveAssetPlan({
    spaceId: resolved.space.id,
    deploymentId: id,
    plan: parsed.data,
    complete,
  })
  if (!result.ok) return errorResponse(result.message, result.status)
  return NextResponse.json({ ok: true, jobId: result.jobId ?? null })
}

export function PUT(req: NextRequest, ctx: Params) {
  return handle(req, ctx, false)
}

export function POST(req: NextRequest, ctx: Params) {
  return handle(req, ctx, true)
}
