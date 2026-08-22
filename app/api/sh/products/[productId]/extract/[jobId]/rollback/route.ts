// 적용을 되돌린다. DB 값 자체는 여기서 쓰지 않는다 — apply/route.ts 와 동일한 이유로
// 실제 쓰기는 클라이언트의 폼 autosave PATCH 가 담당한다(before 스냅샷을 폼 state 에 넣어줌).

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ productId: string; jobId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, jobId } = await params

  const job = await prisma.productExtractionJob.findFirst({
    where: { id: jobId, productId, spaceId: resolved.space.id },
    select: { id: true, appliedAt: true, rolledBackAt: true, appliedBefore: true },
  })
  if (!job) return errorResponse('작업을 찾을 수 없습니다', 404)

  if (!job.appliedAt) {
    return errorResponse('아직 적용되지 않은 작업입니다', 409)
  }
  if (job.rolledBackAt) {
    return errorResponse('이미 롤백된 작업입니다', 409)
  }

  await prisma.productExtractionJob.update({
    where: { id: jobId },
    data: { rolledBackAt: new Date() },
  })

  return NextResponse.json({ before: job.appliedBefore })
}
