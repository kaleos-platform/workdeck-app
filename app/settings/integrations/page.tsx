import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { SETTINGS_INTEGRATIONS_PATH } from '@/lib/deck-routes'
import { IntegrationsGrid } from '@/components/integrations/integrations-grid'
import { loadShellContext } from '@/lib/workspace-shell'
import { loadIntegrationStatuses } from '@/lib/integrations/load-status'
import type { IntegrationId } from '@/lib/integrations/catalog'

// 옛 링크(?tab=·?slack=)를 그리드의 초기 팝업으로 바꾼다. services는 팝업 없음.
const LEGACY_TAB: Record<string, IntegrationId> = { agents: 'agent-tokens', secrets: 'secrets' }

// 외부 서비스 연결 — 서비스 타일 그리드. 상세·입력은 팝업에서 한다.
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
  const { statuses, attention } = shell?.spaceId
    ? await loadIntegrationStatuses(shell.spaceId, user.id, role)
    : { statuses: {}, attention: [] }
  const initialOpen: IntegrationId | null = slack ? 'slack' : (LEGACY_TAB[tab ?? ''] ?? null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">외부 서비스 연결</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          쓰는 서비스를 연결하고 연결 상태를 한눈에 확인하세요.
        </p>
      </div>
      <IntegrationsGrid
        role={role}
        activeDeckIds={(shell?.activeDecks ?? []).map((d) => d.id)}
        statuses={statuses}
        attention={attention}
        slackStatus={slack ?? null}
        initialOpen={initialOpen}
        spaceId={shell?.spaceId ?? undefined}
      />
    </div>
  )
}
