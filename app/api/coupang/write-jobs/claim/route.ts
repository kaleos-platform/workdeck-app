/**
 * POST /api/coupang/write-jobs/claim — 워커 전용. PENDING 잡 1건을 경합 없이 claim 한다.
 * 게이트는 approveAndExecute() 와 같은 패턴: updateMany({where:{id,status:PENDING}})의
 * count===1 만이 승자다. count=0(경합 패자)는 다음 폴링에서 다른 잡을 집는다.
 *
 * workspaceId 로 좁힌다 — resolveCollectionAuth() 가 해석한 워크스페이스(워커가 자격을
 * 가진 바로 그 워크스페이스)와 어긋나면, 다른 워크스페이스 잡을 집어서 항상 실패하는
 * 워크스페이스 축 사고가 난다(멀티 워크스페이스 운영에서 실제로 발생).
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveCollectionAuth } from '@/lib/collection/resolve-workspace'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = await resolveCollectionAuth(request)
  if ('error' in auth) return auth.error

  const candidate = await prisma.coupangWriteJob.findFirst({
    where: { status: 'PENDING', workspaceId: auth.workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!candidate) return NextResponse.json({ job: null })

  // 경합 패자는 count=0 — 다음 폴링에서 다른 잡을 집는다.
  const gate = await prisma.coupangWriteJob.updateMany({
    where: { id: candidate.id, status: 'PENDING' },
    data: { status: 'RUNNING', claimedAt: new Date(), attempts: { increment: 1 } },
  })
  if (gate.count !== 1) return NextResponse.json({ job: null })

  const job = await prisma.coupangWriteJob.findUnique({
    where: { id: candidate.id },
    select: { id: true, workspaceId: true, spaceId: true, kind: true, payload: true },
  })
  return NextResponse.json({ job })
}
