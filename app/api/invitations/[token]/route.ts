import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { findInvitationByToken, invitationState, maskEmail } from '@/lib/spaces/invitations'

// 공개 — 초대 페이지가 로그인 전에 Space·역할을 보여 줄 때 쓴다. 이메일은 가린다.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const inv = await findInvitationByToken(token)
  if (!inv) return errorResponse('초대를 찾을 수 없습니다', 404, { reason: 'not_found' })
  const state = invitationState(inv)
  if (state !== 'pending') return errorResponse('사용할 수 없는 초대입니다', 410, { reason: state })
  return NextResponse.json({
    spaceName: inv.spaceName,
    role: inv.role,
    invitedByName: inv.invitedByName,
    email: maskEmail(inv.email),
    expiresAt: inv.expiresAt,
  })
}
