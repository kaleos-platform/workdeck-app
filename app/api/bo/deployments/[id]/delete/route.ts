import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { enqueueBoJob } from '@/lib/bo/jobs'

type Params = { params: Promise<{ id: string }> }

// POST /api/bo/deployments/[id]/delete — 발행된 글 삭제 트리거
// PUBLISHED 배포만 삭제 가능. 네이버 블로그 + BROWSER 모드 + 자격증명 필수.
// DELETING 으로 전환 후 DELETE_POST job 큐 등록.
export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const deployment = await prisma.boDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: {
      id: true,
      status: true,
      platformUrl: true,
      spaceId: true,
      channel: {
        select: {
          id: true,
          platform: true,
          publisherMode: true,
        },
      },
    },
  })

  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)

  if (deployment.status !== 'PUBLISHED') {
    return errorResponse('PUBLISHED 상태의 배포만 삭제할 수 있습니다', 422)
  }

  if (deployment.channel.platform !== 'NAVER_BLOG') {
    return errorResponse('네이버 블로그만 자동 삭제를 지원합니다', 422)
  }

  if (!deployment.platformUrl) {
    return errorResponse('게시 URL이 없어 삭제할 수 없습니다', 422)
  }

  if (deployment.channel.publisherMode !== 'BROWSER') {
    return errorResponse('BROWSER 모드 채널에서만 자동 삭제가 가능합니다', 422)
  }

  // 자격증명 존재 확인
  const credCount = await prisma.boChannelCredential.count({
    where: { channelId: deployment.channel.id },
  })
  if (credCount === 0) {
    return errorResponse(
      '채널에 등록된 자격증명이 없습니다. 채널 설정에서 자격증명을 등록해 주세요.',
      422
    )
  }

  // 이미 진행 중인 DELETE_POST job 이 있으면 중복 큐 등록 방지
  const inflightJob = await prisma.boJob.findFirst({
    where: {
      targetId: id,
      kind: 'DELETE_POST',
      status: { in: ['PENDING', 'CLAIMED'] },
    },
    select: { id: true },
  })
  if (inflightJob) {
    return errorResponse('이미 처리 중인 삭제 작업이 있습니다', 409)
  }

  // 배포 DELETING 전환 + DELETE_POST job 큐 등록
  await prisma.boDeployment.update({
    where: { id },
    data: { status: 'DELETING' },
  })

  await enqueueBoJob({
    spaceId: resolved.space.id,
    kind: 'DELETE_POST',
    targetId: id,
    payload: { deploymentId: id },
  })

  return NextResponse.json({ deployment: { id, status: 'DELETING' } }, { status: 201 })
}
