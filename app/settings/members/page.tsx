import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_MEMBERS_PATH } from '@/lib/deck-routes'
import { MembersCard } from '@/components/settings/members-card'
import { loadShellContext } from '@/lib/workspace-shell'
import { RoleRequired } from '@/components/settings/role-required'

export default async function MembersSettingsPage() {
  const user = await getUser()
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_MEMBERS_PATH)}`)
  const role = (await loadShellContext(user.id))?.role ?? 'MEMBER'
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">팀원 초대·관리</h1>
        <p className="text-sm text-muted-foreground">
          함께 일하는 사람을 보고, 소유자는 이메일로 초대하고 역할을 정할 수 있습니다.
        </p>
      </header>
      <RoleRequired role={role} min="ADMIN">
        <MembersCard />
      </RoleRequired>
    </div>
  )
}
