import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_INTEGRATIONS_PATH } from '@/lib/deck-routes'
import { SlackConnectCard } from '@/components/integrations/slack-connect-card'
import { AgentToggleCard } from '@/components/integrations/agent-toggle-card'
import { McpGuideCard } from '@/components/integrations/mcp-guide-card'
import { CoupangApiCard } from '@/components/integrations/coupang-api-card'
import { loadShellContext } from '@/lib/workspace-shell'
import { RoleRequired } from '@/components/settings/role-required'

// 에이전트 연동 설정 — Slack 연결, workdeck 에이전트 토글, 내 MCP 클라이언트 연결 가이드.
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ slack?: string }>
}) {
  const user = await getUser()
  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(SETTINGS_INTEGRATIONS_PATH)}`)
  }

  const { slack } = await searchParams
  const role = (await loadShellContext(user.id))?.role ?? 'MEMBER'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">연동 설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Slack 연결과 워크덱 에이전트, 외부 MCP 클라이언트 연동을 관리하세요.
        </p>
      </div>

      <div className="grid gap-6">
        {/* Slack·쿠팡 API·에이전트는 ADMIN 이상, 내 MCP 연결 가이드는 누구나 */}
        <RoleRequired role={role} min="ADMIN" what="Slack·쿠팡 API·에이전트 연동">
          <SlackConnectCard slackStatus={slack ?? null} />
          <CoupangApiCard />
          <AgentToggleCard />
        </RoleRequired>
        <McpGuideCard />
      </div>
    </div>
  )
}
