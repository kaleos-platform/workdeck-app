import { AiSettingsForm } from '@/components/settings/ai-settings-form'
import { loadShellContext } from '@/lib/workspace-shell'
import { RoleRequired } from '@/components/settings/role-required'
import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_AI_PATH } from '@/lib/deck-routes'

export default async function AiSettingsPage() {
  const user = await getUser()
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_AI_PATH)}`)
  const role = (await loadShellContext(user.id))?.role ?? 'MEMBER'
  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">AI 설정</h1>
        <p className="text-sm text-muted-foreground">
          글쓰기·아이디어 같은 AI 기능에 어떤 AI를 쓸지 고릅니다. 이 작업 공간 전체에 적용됩니다.
        </p>
      </header>
      <RoleRequired role={role} min="ADMIN">
        <AiSettingsForm />
      </RoleRequired>
    </div>
  )
}
