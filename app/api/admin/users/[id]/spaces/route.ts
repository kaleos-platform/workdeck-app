import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { EnableDeckError, enableDeckInTx } from '@/lib/spaces/enable-deck'
import { createOwnedSpaceInTx } from '@/lib/spaces/create-owned-space'
import { createSpaceSchema } from '@/lib/validations/admin-users'

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
      const created = await createOwnedSpaceInTx(tx, { userId: id, name })
      if ('duplicateSpaceId' in created || 'limitReached' in created) return created
      const { space, blockedJobs } = created
      // 어드민 생성은 체험 1회 규칙 미적용(운영자가 Space 를 대신 만들어 줄 때 체험 허용).
      if (enableRecruiting)
        await enableDeckInTx(tx, space.id, 'recruiting', { trialOncePerOwner: false })

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

    if ('limitReached' in result)
      return errorResponse('소유 Space 상한에 도달했습니다', 409, { code: 'SPACE_LIMIT' })
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
