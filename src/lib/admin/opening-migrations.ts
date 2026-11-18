import 'server-only'
import { decryptField } from '@/lib/crypto/field-crypto'
import { prisma } from '@/lib/prisma'

// 행 하나의 복호화 실패가 목록 전체를 막지 않게 한다.
function readContactHits(enc: string | null, iv: string | null) {
  if (!enc || !iv) return null
  try {
    return JSON.parse(decryptField('pii', enc, iv))
  } catch {
    return 'DECRYPT_FAILED'
  }
}

// 오프닝 자동 이전 큐 조회(운영자 전용). 연락처 조각은 여기서만 복호화한다.
// API(GET)와 어드민 페이지가 함께 쓴다. 호출 전에 requireOperator 로 확정 검증해야 한다.
export async function listOpeningMigrationJobs() {
  // ponytail: 전체 조회 — DONE·HELD 누적이 수백 건을 넘으면 완료·보류는 최근 N건만
  const jobs = await prisma.openingMigrationJob.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      openingBrandId: true,
      targetSpaceId: true,
      status: true,
      summary: true,
      blockReasons: true,
      contactHitsEnc: true,
      contactHitsIv: true,
      error: true,
      approvedBy: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { email: true } },
    },
  })
  const spaceIds = [
    ...new Set(jobs.flatMap((job) => (job.targetSpaceId ? [job.targetSpaceId] : []))),
  ]
  const spaces = await prisma.space.findMany({
    where: { id: { in: spaceIds } },
    select: { id: true, name: true },
  })
  const spaceName = new Map(spaces.map((space) => [space.id, space.name]))
  return jobs.map((job) => {
    // 승인 기준 snapshot 은 서버에서만 쓰고 내려주지 않는다. 승인 가능 여부만 hasSnapshot 으로 알린다.
    const { snapshot, ...summary } = (job.summary ?? {}) as Record<string, unknown>
    return {
      id: job.id,
      openingBrandId: job.openingBrandId,
      userEmail: job.user?.email ?? null,
      targetSpaceId: job.targetSpaceId,
      targetSpaceName: job.targetSpaceId ? (spaceName.get(job.targetSpaceId) ?? null) : null,
      status: job.status,
      summary,
      hasSnapshot: !!snapshot,
      blockReasons: job.blockReasons,
      contactHits: readContactHits(job.contactHitsEnc, job.contactHitsIv),
      error: job.error,
      approvedBy: job.approvedBy,
      approvedAt: job.approvedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }
  })
}
