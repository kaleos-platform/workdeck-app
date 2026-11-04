// POST /api/sc/jobs/[id]/publish-attempt — 워커가 최종 「발행」을 누르기 직전에 호출한다.
// 배포당 한 번만 통과한다: 이미 시도한 배포(재시도·stale 회수)는 { ok: false } → 워커는 발행하지 않고 사람 확인으로 넘긴다.

import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { authenticateWorker, workerOwns } from '@/lib/worker-auth'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await authenticateWorker(req.headers)
  if ('error' in auth) return auth.error

  const { id } = await params
  const job = await prisma.salesContentJob.findUnique({
    where: { id },
    select: { spaceId: true, kind: true, status: true, targetId: true },
  })
  if (!job || !workerOwns(auth.scope, { spaceId: job.spaceId })) {
    return errorResponse('job 이 없습니다', 404)
  }
  if (job.kind !== 'PUBLISH' || job.status !== 'CLAIMED' || !job.targetId) {
    return NextResponse.json({ ok: false })
  }
  const marked = await prisma.contentDeployment.updateMany({
    where: {
      id: job.targetId,
      spaceId: job.spaceId,
      status: 'PUBLISHING',
      publishAttemptedAt: null,
    },
    data: { publishAttemptedAt: new Date() },
  })
  return NextResponse.json({ ok: marked.count === 1 })
}
