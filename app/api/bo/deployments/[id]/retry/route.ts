import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { enqueueBoJob } from '@/lib/bo/jobs'

type Params = { params: Promise<{ id: string }> }

// POST /api/bo/deployments/[id]/retry — FAILED 배포 재시도
// 배포를 PENDING 으로 리셋하고 새 PUBLISH 작업을 큐에 등록
export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const deployment = await prisma.boDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: {
      id: true,
      status: true,
      spaceId: true,
      postId: true,
      variantId: true,
      channelId: true,
    },
  })

  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)
  if (deployment.status !== 'FAILED') {
    return errorResponse('FAILED 상태의 배포만 재시도할 수 있습니다', 422)
  }

  // 이미 진행 중인 PUBLISH job 이 있으면 중복 큐 등록 방지 (상태 리셋 전에 확인)
  const inflightJob = await prisma.boJob.findFirst({
    where: {
      targetId: deployment.id,
      kind: 'PUBLISH',
      status: { in: ['PENDING', 'CLAIMED'] },
    },
    select: { id: true },
  })
  if (inflightJob) {
    return errorResponse('이미 처리 중인 발행 작업이 있습니다', 409)
  }

  // 배포 상태를 PENDING 으로 리셋
  await prisma.boDeployment.update({
    where: { id },
    data: { status: 'PENDING', errorCode: null, errorMessage: null },
  })

  // 새 PUBLISH 작업 큐에 등록
  const job = await enqueueBoJob({
    spaceId: deployment.spaceId,
    kind: 'PUBLISH',
    targetId: deployment.id,
    payload: { deploymentId: deployment.id },
  })

  return NextResponse.json({ deployment: { id, status: 'PENDING' }, job: { id: job.id } })
}
