import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { getUser } from '@/hooks/use-user'
import { writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { InvitationError, acceptInvitation } from '@/lib/spaces/invitations'

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const user = await getUser()
  if (!user) return errorResponse('로그인이 필요합니다', 401)
  const meta = (user.user_metadata ?? {}) as { name?: string; full_name?: string }
  try {
    const { spaceId, invitationId } = await acceptInvitation({
      token,
      user: {
        id: user.id,
        email: user.email,
        // 이메일 확인 여부는 Supabase 세션에서만 — 클라이언트 입력은 받지 않는다.
        emailConfirmed: Boolean(user.email_confirmed_at),
        name: meta.name ?? meta.full_name ?? null,
      },
    })
    await writeAuditLog(user.id, 'space.invitation.accept', 'space_invitation', invitationId, {
      spaceId,
    })
    return NextResponse.json({ spaceId })
  } catch (err) {
    if (err instanceof InvitationError)
      return errorResponse(err.message, err.status, { reason: err.reason })
    // User.email 고유 충돌(같은 이메일의 다른 id 행) 또는 SpaceMember 동시 생성.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse('이미 처리된 계정 정보와 충돌합니다. 관리자에게 문의하세요.', 409, {
        reason: 'conflict',
      })
    }
    throw err
  }
}
