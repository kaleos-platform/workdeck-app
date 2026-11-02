// POST /api/sc/deployments/[id]/complete-manual — 수동 게시 후 게시 URL 등록 + 게시 완료.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { completeManualDeployment } from '@/lib/sc/manual-publish'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({ platformUrl: z.string().trim().min(1).max(2000) })

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return errorResponse('게시물 주소를 입력하세요', 400)

  const { id } = await params
  const result = await completeManualDeployment({
    spaceId: resolved.space.id,
    deploymentId: id,
    platformUrl: parsed.data.platformUrl,
  })
  if (!result.ok) return errorResponse(result.message, result.status)
  return NextResponse.json({ platformUrl: result.platformUrl, alreadyDone: result.alreadyDone })
}
