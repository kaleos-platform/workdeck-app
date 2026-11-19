import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { EnableDeckError, enableDeckInTx } from '@/lib/spaces/enable-deck'
import { lockOwnerSpaces } from '@/lib/spaces/owner-space-lock'
import { createSpaceSchema } from '@/lib/validations/admin-users'
import { Prisma, type OpeningMigrationStatus } from '@/generated/prisma/client'

// POST /api/admin/users/[id]/spaces — { name, enableRecruiting? } 기존 사용자를 OWNER 로 하는 새 Space 생성
// 같은 OWNER 에게 같은 이름 Space 가 이미 있으면 409 + 기존 spaceId(재시도·동시 제출 중복 방지).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params
  const parsed = createSpaceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 422, { issues: parsed.error.issues })
  }
  const { name, enableRecruiting } = parsed.data

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) return errorResponse('사용자를 찾을 수 없습니다', 404)

  // 정지 판정은 어드민 사용자 상세와 같은 방식(Supabase Auth banned_until)을 쓴다.
  const { data, error } = await getSupabaseAdminClient().auth.admin.getUserById(id)
  if (error || !data?.user) return errorResponse('사용자 인증 상태를 확인하지 못했습니다', 502)
  const bannedUntil = (data.user as { banned_until?: string | null }).banned_until
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
    return errorResponse('정지된 사용자에게는 Space 를 만들 수 없습니다', 409)
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockOwnerSpaces(tx, id)

      const owned = await tx.spaceMember.findMany({
        where: { userId: id, role: 'OWNER' },
        select: { space: { select: { id: true, name: true } } },
      })
      const same = owned.find((m) => m.space.name.trim().normalize('NFC') === name)
      if (same) return { duplicateSpaceId: same.space.id }

      const space = await tx.space.create({
        data: { name, type: 'PERSONAL', members: { create: { userId: id, role: 'OWNER' } } },
        select: { id: true, name: true },
      })
      if (enableRecruiting) await enableDeckInTx(tx, space.id, 'recruiting')

      // OWNER Space 가 2개 이상이 되면 적용 전 오프닝 이전 job 은 대상이 모호해지므로 무효화한다.
      // NO_TARGET_SPACE 로만 막힌 BLOCKED 는 워커 재계획이 새 Space 를 고르지 못하게 사유를 갱신한다.
      let blockedJobs = 0
      if ((await tx.spaceMember.count({ where: { userId: id, role: 'OWNER' } })) > 1) {
        const jobs = await tx.openingMigrationJob.findMany({
          where: {
            userId: id,
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
          let job: { id: string; status: OpeningMigrationStatus; blockReasons: string[] } | null =
            found
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

      await writeAuditLog(
        auth.user.id,
        'space.create',
        'space',
        space.id,
        { ownerUserId: id, name, enableRecruiting, blockedJobs },
        tx
      )
      return { space, blockedJobs }
    })

    if ('duplicateSpaceId' in result) {
      return errorResponse('같은 이름의 Space 가 이미 있습니다', 409, {
        spaceId: result.duplicateSpaceId,
      })
    }
    return NextResponse.json(
      { space: result.space, blockedJobs: result.blockedJobs },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof EnableDeckError) {
      if (error.code === 'DECK_CLOSED') return errorResponse('준비중인 업무입니다', 403)
      if (error.code === 'DECK_SUBSCRIPTION_REQUIRED')
        return errorResponse('구독이 필요한 업무입니다', 402)
    }
    return errorResponse('Space 를 만들지 못했습니다', 500)
  }
}
