import { getUser } from '@/hooks/use-user'
import { findInvitationByToken, invitationState, maskEmail } from '@/lib/spaces/invitations'
import { inviteView } from '@/lib/spaces/invite-page-state'
import { InviteAccept } from '@/components/invite/invite-accept'

export const metadata = { title: 'Workdeck Space 초대' }

const ROLE_LABEL = { ADMIN: '관리자(ADMIN)', MEMBER: '구성원(MEMBER)' } as const
const INVALID_TEXT = {
  expired: '초대가 만료되었습니다. 초대한 분께 다시 요청하세요.',
  revoked: '취소된 초대입니다.',
  accepted: '이미 사용한 초대입니다. 로그인해서 이용하세요.',
  not_found: '초대를 찾을 수 없습니다. 링크를 다시 확인하세요.',
} as const

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [inv, user] = await Promise.all([findInvitationByToken(token), getUser()])
  const state = inv ? invitationState(inv) : 'not_found'
  const view = inviteView({ state, inviteEmail: inv?.email ?? null, user })

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      {view === 'invalid' || !inv ? (
        <p className="text-sm text-muted-foreground">
          {INVALID_TEXT[state as keyof typeof INVALID_TEXT]}
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{inv.spaceName}에 초대되었습니다</h1>
            <p className="text-sm text-muted-foreground">
              {inv.invitedByName ?? 'Space 소유자'}님이 {ROLE_LABEL[inv.role]}로 초대했습니다.
              초대받은 이메일: {maskEmail(inv.email)}
            </p>
          </div>
          <InviteAccept
            token={token}
            view={view}
            invitePath={`/invite/${token}`}
            inviteEmail={inv.email}
          />
        </>
      )}
    </main>
  )
}
