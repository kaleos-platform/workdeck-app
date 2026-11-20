import { lockOwnerSpaces } from '@/lib/spaces/owner-space-lock'
import { Prisma, type OpeningMigrationStatus } from '@/generated/prisma/client'

export { MAX_OWNED_SPACES } from '@/lib/spaces/owned-space-limit'

export type CreateOwnedSpaceResult =
  | { duplicateSpaceId: string }
  | { limitReached: true }
  | { space: { id: string; name: string }; blockedJobs: number }

/**
 * 사용자를 OWNER 로 하는 새 Space 를 만든다(호출자 transaction 안에서 실행).
 * 사용자 단위 lock → 같은 이름 검사 → (maxOwned 가 있으면) 소유 개수 검사 → 생성 → 오프닝 이전 job 무효화.
 * 업무 켜기·감사 로그는 호출자 몫이다. name 은 trim·NFC 로 정규화된 값이어야 한다.
 */
export async function createOwnedSpaceInTx(
  tx: Prisma.TransactionClient,
  { userId, name, maxOwned }: { userId: string; name: string; maxOwned?: number }
): Promise<CreateOwnedSpaceResult> {
  await lockOwnerSpaces(tx, userId)

  const owned = await tx.spaceMember.findMany({
    where: { userId, role: 'OWNER' },
    select: { space: { select: { id: true, name: true } } },
  })
  const same = owned.find((m) => m.space.name.trim().normalize('NFC') === name)
  if (same) return { duplicateSpaceId: same.space.id }
  if (maxOwned !== undefined && owned.length >= maxOwned) return { limitReached: true }

  const space = await tx.space.create({
    data: { name, type: 'PERSONAL', members: { create: { userId, role: 'OWNER' } } },
    select: { id: true, name: true },
  })

  // OWNER Space 가 2개 이상이 되면 적용 전 오프닝 이전 job 은 대상이 모호해지므로 무효화한다.
  // NO_TARGET_SPACE 로만 막힌 BLOCKED 는 워커 재계획이 새 Space 를 고르지 못하게 사유를 갱신한다.
  let blockedJobs = 0
  if ((await tx.spaceMember.count({ where: { userId, role: 'OWNER' } })) > 1) {
    const jobs = await tx.openingMigrationJob.findMany({
      where: {
        userId,
        OR: [
          { status: { in: ['MATCHED', 'PLANNED', 'APPROVED'] } },
          { status: 'BLOCKED', blockReasons: { equals: ['NO_TARGET_SPACE'] } },
        ],
      },
      select: { id: true, status: true, blockReasons: true },
    })
    // 조건부 update 가 0건이면(그 사이 워커가 상태·사유를 바꿈) 다시 읽어 최대 3번 재시도한다.
    // ponytail: 3회 상한 — 워커는 한 주기에 1건만 바꾸므로 실무상 충분, 초과 시 운영자가 --close-job/보류로 정리
    const invalidatable = (j: { status: OpeningMigrationStatus; blockReasons: string[] }) =>
      ['MATCHED', 'PLANNED', 'APPROVED'].includes(j.status) ||
      (j.status === 'BLOCKED' &&
        j.blockReasons.length === 1 &&
        j.blockReasons[0] === 'NO_TARGET_SPACE')
    for (const found of jobs) {
      let job: { id: string; status: OpeningMigrationStatus; blockReasons: string[] } | null = found
      for (let attempt = 0; attempt < 3 && job && invalidatable(job); attempt++) {
        const { count } = await tx.openingMigrationJob.updateMany({
          // 조회한 사유가 그대로일 때만 바꾼다(그 사이 워커가 MULTI_USER 등을 더했으면 덮어쓰지 않음).
          where: {
            id: job.id,
            status: job.status as never,
            blockReasons: { equals: job.blockReasons },
          },
          data: {
            status: 'BLOCKED',
            // NO_TARGET_SPACE 단독 사유는 교체한다(워커 재시도 조회는 단독 사유 배열만 본다).
            blockReasons:
              job.status === 'BLOCKED'
                ? ['MULTIPLE_OWNER_SPACES']
                : [...new Set([...job.blockReasons, 'MULTIPLE_OWNER_SPACES'])],
            approvedBy: null,
            approvedAt: null,
            approvedSnapshot: Prisma.DbNull,
          },
        })
        if (count === 1) {
          blockedJobs++
          break
        }
        job = await tx.openingMigrationJob.findUnique({
          where: { id: found.id },
          select: { id: true, status: true, blockReasons: true },
        })
      }
    }
  }

  return { space, blockedJobs }
}
