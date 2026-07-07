import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

// POST /api/bo/deployments/[id]/cancel — PENDING 배포 취소
// CANCELED 상태로 전환. 워커가 이미 job 을 claim 한 경우
// complete 시 status 가드에 의해 deployment 는 변경되지 않는다.
export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const deployment = await prisma.boDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })

  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)
  if (deployment.status !== 'PENDING') {
    return errorResponse('PENDING 상태의 배포만 취소할 수 있습니다', 422)
  }

  await prisma.boDeployment.update({
    where: { id },
    data: { status: 'CANCELED' },
  })

  return NextResponse.json({ deployment: { id, status: 'CANCELED' } })
}
