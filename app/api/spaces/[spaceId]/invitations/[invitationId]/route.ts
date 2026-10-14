import { NextResponse } from 'next/server'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { requireAal2 } from '@/lib/auth/mfa'
import { writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { revokeInvitation } from '@/lib/spaces/invitations'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string; invitationId: string }> }
) {
  const { spaceId, invitationId } = await params
  const owner = await requireSpaceOwner(spaceId)
  if ('error' in owner) return owner.error
  const mfa = await requireAal2()
  if (mfa) return mfa
  if (!(await revokeInvitation(spaceId, invitationId))) {
    return errorResponse('대기 중인 초대를 찾을 수 없습니다', 404)
  }
  await writeAuditLog(owner.userId, 'space.invitation.revoke', 'space_invitation', invitationId, {
    spaceId,
  })
  return NextResponse.json({ ok: true })
}
