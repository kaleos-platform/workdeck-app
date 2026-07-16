import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_INTEGRATIONS_PATH } from '@/lib/deck-routes'
import { SlackConnectCard } from '@/components/integrations/slack-connect-card'
import { AgentToggleCard } from '@/components/integrations/agent-toggle-card'
import { McpGuideCard } from '@/components/integrations/mcp-guide-card'

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">연동 설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Slack 연결과 워크덱 에이전트, 외부 MCP 클라이언트 연동을 관리하세요.
        </p>
      </div>

      <div className="grid gap-6">
        <SlackConnectCard slackStatus={slack ?? null} />
        <AgentToggleCard />
        <McpGuideCard />
      </div>
    </div>
  )
}
