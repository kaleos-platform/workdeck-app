// POST /api/sc/deployments/[id]/execute
// → PUBLISH job 을 큐에 넣고 deployment 상태를 SCHEDULED → PUBLISHING 으로 변경.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { enqueueJob } from '@/lib/sc/jobs'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: { content: { select: { status: true } } },
  })
  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)
  if (deployment.status === 'PUBLISHING' || deployment.status === 'PUBLISHED') {
    return errorResponse(`이미 ${deployment.status} 상태입니다`, 409)
  }
  if (deployment.content.status !== 'APPROVED' && deployment.content.status !== 'SCHEDULED') {
    return errorResponse('APPROVED 이상의 콘텐츠만 배포 실행할 수 있습니다', 409)
  }

  await prisma.contentDeployment.update({
    where: { id },
    data: { status: 'PUBLISHING', errorMessage: null },
  })
  const enqueued = await enqueueJob({
    spaceId: resolved.space.id,
    kind: 'PUBLISH',
    targetId: deployment.id,
    payload: { deploymentId: deployment.id },
    scheduledAt: deployment.scheduledAt ?? new Date(),
  })

  return NextResponse.json({ jobId: enqueued.id }, { status: 202 })
}
