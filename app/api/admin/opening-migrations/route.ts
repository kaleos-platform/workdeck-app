import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { decryptField } from '@/lib/crypto/field-crypto'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

// 행 하나의 복호화 실패가 목록 전체를 막지 않게 한다.
function readContactHits(enc: string | null, iv: string | null) {
  if (!enc || !iv) return null
  try {
    return JSON.parse(decryptField('pii', enc, iv))
  } catch {
    return 'DECRYPT_FAILED'
  }
}

// GET /api/admin/opening-migrations — 오프닝 자동 이전 큐(운영자 전용). 연락처 조각은 여기서만 복호화한다.
export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  try {
    const jobs = await prisma.openingMigrationJob.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true } } },
    })
    const spaceIds = [
      ...new Set(jobs.flatMap((job) => (job.targetSpaceId ? [job.targetSpaceId] : []))),
    ]
    const spaces = await prisma.space.findMany({
      where: { id: { in: spaceIds } },
      select: { id: true, name: true },
    })
    const spaceName = new Map(spaces.map((space) => [space.id, space.name]))
    return NextResponse.json(
      {
        jobs: jobs.map((job) => ({
          id: job.id,
          openingBrandId: job.openingBrandId,
          userEmail: job.user?.email ?? null,
          targetSpaceId: job.targetSpaceId,
          targetSpaceName: job.targetSpaceId ? (spaceName.get(job.targetSpaceId) ?? null) : null,
          status: job.status,
          summary: job.summary,
          blockReasons: job.blockReasons,
          contactHits: readContactHits(job.contactHitsEnc, job.contactHitsIv),
          error: job.error,
          approvedBy: job.approvedBy,
          approvedAt: job.approvedAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })),
      },
      { headers }
    )
  } catch {
    return NextResponse.json(
      { message: '오프닝 이전 목록을 불러오지 못했습니다' },
      { status: 500, headers }
    )
  }
}
