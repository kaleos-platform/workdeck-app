import { NextResponse } from 'next/server'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'
import { isAal2Fresh } from '@/lib/auth/mfa'
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
  // 취소는 권한을 줄이는 동작이라 OWNER 만 확인(AAL2 불필요). 사고 추적용으로 aal 을 감사 로그에 남긴다.
  if (!(await revokeInvitation(spaceId, invitationId))) {
    return errorResponse('대기 중인 초대를 찾을 수 없습니다', 404)
  }
  await writeAuditLog(owner.userId, 'space.invitation.revoke', 'space_invitation', invitationId, {
    spaceId,
    aal: (await isAal2Fresh()) ? 'aal2' : 'aal1',
  })
  return NextResponse.json({ ok: true })
}
