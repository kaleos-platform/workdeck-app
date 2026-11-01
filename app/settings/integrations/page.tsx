import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_INTEGRATIONS_PATH } from '@/lib/deck-routes'
import { IntegrationsTabs } from '@/components/integrations/integrations-tabs'
import { McpGuideCard } from '@/components/integrations/mcp-guide-card'
import { loadShellContext } from '@/lib/workspace-shell'
import { RoleRequired } from '@/components/settings/role-required'
import { hasRole } from '@/lib/auth/roles'
import { loadIntegrationAttention } from '@/lib/integrations/load-attention'

// 에이전트 연동 설정 — Slack 연결, workdeck 에이전트 토글, 내 MCP 클라이언트 연결 가이드.
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ slack?: string; tab?: string }>
}) {
  const user = await getUser()
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_INTEGRATIONS_PATH)}`)
  }

  const { slack, tab } = await searchParams
  const shell = await loadShellContext(user.id)
  const role = shell?.role ?? 'MEMBER'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">연동 설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Slack 연결과 워크덱 에이전트, 외부 MCP 클라이언트 연동을 관리하세요.
        </p>
      </div>

      {/* Slack·쿠팡 API·에이전트는 ADMIN 이상, 내 MCP 연결 가이드는 누구나 */}
      {hasRole(role, 'ADMIN') ? (
        <IntegrationsTabs
          attention={shell?.spaceId ? await loadIntegrationAttention(shell.spaceId, user.id) : []}
          slackStatus={slack ?? null}
          tab={tab}
        />
      ) : (
        <div className="grid gap-6">
          <RoleRequired role={role} min="ADMIN" what="Slack·쿠팡 API·에이전트 연동">
            {null}
          </RoleRequired>
          <McpGuideCard />
        </div>
      )}
    </div>
  )
}
