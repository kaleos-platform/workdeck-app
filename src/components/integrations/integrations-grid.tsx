'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { OsmuConnections } from '@/components/sc/settings/osmu-connections'
import { SETTINGS_ACCOUNT_PATH } from '@/lib/deck-routes'
import { hasRole, type Role } from '@/lib/auth/roles'
import {
  INTEGRATIONS,
  INTEGRATION_GROUPS,
  type IntegrationId,
  type IntegrationService,
  type IntegrationState,
} from '@/lib/integrations/catalog'
import type { AttentionItem } from '@/lib/integrations/attention'
import type { IntegrationStatuses } from '@/lib/integrations/load-status'
import { AdCredentialForm } from './ad-credential-form'
import { AgentToggleCard } from './agent-toggle-card'
import { AgentTokensCard } from './agent-tokens-card'
import { Cafe24ConnectCard } from './cafe24-connect-card'
import { CoupangApiCard } from './coupang-api-card'
import { IntegrationDialog, ServiceLogo } from './integration-dialog'
import { McpGuideCard } from './mcp-guide-card'
import { SlackConnectCard } from './slack-connect-card'
import { SpaceSecretsCard } from './space-secrets-card'

// DESIGN.md §2.2 상태 색 — 라이트/다크 짝.
const BADGE: Record<IntegrationState, { label: string; className: string }> = {
  connected: {
    label: '연결됨',
    className:
      'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-400',
  },
  not_connected: { label: '연결 필요', className: 'border-border text-muted-foreground' },
  attention: {
    label: '확인 필요',
    className:
      'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400',
  },
  unknown: { label: '확인 불가', className: 'border-border text-muted-foreground' },
}

export function IntegrationsGrid({
  role,
  activeDeckIds,
  statuses,
  attention,
  slackStatus,
  initialOpen,
  spaceId,
}: {
  role: Role
  activeDeckIds: string[]
  statuses: IntegrationStatuses
  attention: AttentionItem[]
  slackStatus: string | null
  /** 옛 링크(?tab=·?slack=)를 서버가 변환한 값. 마운트 직후 한 번만 URL의 open으로 옮긴다. */
  initialOpen: IntegrationId | null
  /** 광고 키 팝업이 설정 API 주소에 쓴다. */
  spaceId?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isAdmin = hasRole(role, 'ADMIN')
  const refresh = useCallback(() => router.refresh(), [router])

  const visible = INTEGRATIONS.filter(
    (s) =>
      (!s.requiredDeck || activeDeckIds.includes(s.requiredDeck)) && (isAdmin || !s.hiddenForMember)
  )
  // 팝업을 열 수 있는 서비스: 다이얼로그형이고, MEMBER는 관리자 전용 본문을 마운트하지 않는다.
  const openable = visible.filter((s) => s.kind === 'dialog' && (isAdmin || !s.adminOnly))
  const openableKey = openable.map((s) => s.id).join(',')

  const [hosts, setHosts] = useState<Partial<Record<string, HTMLDivElement>>>({})
  useEffect(() => {
    // 이미 있는 host는 재사용한다 — 새로 만들면 portal이 다시 마운트돼 카드 state(입력값·일회용 토큰)가 사라진다.
    setHosts((prev) =>
      Object.fromEntries(
        openableKey
          .split(',')
          .filter(Boolean)
          .map((id) => [id, prev[id] ?? document.createElement('div')])
      )
    )
  }, [openableKey])
  // OAuth 복귀 결과는 처음 값을 고정한다 — 옛 query를 지우면 서버가 null을 다시 내려 안내가 사라진다.
  const [initialSlackStatus] = useState(slackStatus)
  const [initialCafe24Result] = useState(() => searchParams.get('cafe24'))
  const [initialCafe24Mall] = useState(() => searchParams.get('mall'))
  const [initialGoogleResult] = useState(() => searchParams.get('google'))

  const hasLegacy = searchParams.has('tab') || searchParams.has('slack')
  const urlOpen = searchParams.get('open')
  const raw = urlOpen ?? (hasLegacy ? initialOpen : null)
  const open = openable.find((s) => s.id === raw)?.id ?? null

  const replace = useCallback(
    (edit: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      edit(params)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  // 옛 query는 한 번만 쓰고 지운다 — 닫은 뒤 새로고침해도 다시 열리지 않게.
  useEffect(() => {
    if (!hasLegacy) return
    replace((params) => {
      params.delete('tab')
      params.delete('slack')
      if (initialOpen) params.set('open', initialOpen)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번만
  }, [])

  const openDialog = (id: IntegrationId) => replace((params) => params.set('open', id))
  const closeDialog = () => {
    replace((params) => params.delete('open'))
    router.refresh()
  }

  const counts = { connected: 0, not_connected: 0, attention: 0 }
  for (const s of visible) {
    const state = statuses[s.id]?.state
    if (state && state !== 'unknown') counts[state]++
  }

  const bodies: Partial<Record<IntegrationId, ReactNode>> = {
    slack: <SlackConnectCard embedded slackStatus={initialSlackStatus} />,
    cafe24: (
      <Cafe24ConnectCard
        embedded
        result={initialCafe24Result}
        resultMall={initialCafe24Mall}
        onChanged={refresh}
      />
    ),
    'coupang-api': <CoupangApiCard embedded onChanged={refresh} />,
    notion: <OsmuConnections only="notion" embedded />,
    'google-drive': <OsmuConnections only="drive" embedded />,
    'workdeck-agent': <AgentToggleCard embedded />,
    'my-ai-app': (
      <div className="space-y-3">
        <McpGuideCard embedded />
        <p className="text-sm text-muted-foreground">
          연결한 AI 앱은{' '}
          <Link
            href={SETTINGS_ACCOUNT_PATH}
            className="text-primary underline-offset-4 hover:underline"
          >
            계정 설정의 연결된 AI 앱
          </Link>
          에서 확인하고 해제합니다.
        </p>
      </div>
    ),
    'agent-tokens': <AgentTokensCard embedded onChanged={refresh} />,
    secrets: <SpaceSecretsCard embedded onChanged={refresh} />,
    ...(spaceId
      ? {
          'meta-ads': (
            <AdCredentialForm provider="meta-ads" spaceId={spaceId} onChanged={refresh} />
          ),
          'google-marketing': (
            <AdCredentialForm
              provider="google-marketing"
              spaceId={spaceId}
              onChanged={refresh}
              googleResult={initialGoogleResult}
            />
          ),
          'naver-searchad': (
            <AdCredentialForm provider="naver-searchad" spaceId={spaceId} onChanged={refresh} />
          ),
        }
      : {}),
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-sm tabular-nums" role="status">
          <span className="font-medium">연결됨 {counts.connected}</span>
          <span className="text-muted-foreground"> · 연결 필요 {counts.not_connected}</span>
          {isAdmin && (
            <span
              className={
                counts.attention > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground'
              }
            >
              {' '}
              · 확인 필요 {counts.attention}
            </span>
          )}
        </p>
        {isAdmin && attention.length > 0 && (
          <Alert>
            <AlertTitle>확인 필요 {attention.length}건</AlertTitle>
            <AlertDescription>
              <ul className="w-full divide-y">
                {attention.map((item) => (
                  <li key={item.message} className="flex items-center justify-between gap-3 py-2">
                    <span className="line-clamp-2 min-w-0 break-words">{item.message}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => openDialog(item.id)}
                    >
                      확인
                    </Button>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {INTEGRATION_GROUPS.map((group) => {
        const tiles = visible.filter((s) => s.group === group)
        if (tiles.length === 0) return null
        return (
          <section key={group} aria-labelledby={`group-${group}`} className="space-y-3">
            <h2 id={`group-${group}`} className="text-sm font-semibold">
              {group}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tiles.map((service) => (
                <Tile
                  key={service.id}
                  service={service}
                  isAdmin={isAdmin}
                  status={statuses[service.id]}
                  canOpen={openable.some((s) => s.id === service.id)}
                  onOpen={() => openDialog(service.id)}
                />
              ))}
            </ul>
          </section>
        )
      })}

      {openable.map((service) => (
        <IntegrationDialog
          key={service.id}
          service={service}
          open={open === service.id}
          onClose={closeDialog}
          host={hosts[service.id]}
        />
      ))}
      {/* 본문은 팝업 밖에서 항상 마운트 — 닫거나 ?open이 바뀌어도 카드 state가 남는다. */}
      {openable.map((service) => {
        const host = hosts[service.id]
        return host ? createPortal(bodies[service.id], host, service.id) : null
      })}
    </div>
  )
}

function Tile({
  service,
  isAdmin,
  status,
  canOpen,
  onOpen,
}: {
  service: IntegrationService
  isAdmin: boolean
  status: { state: IntegrationState; summary?: string } | undefined
  canOpen: boolean
  onOpen: () => void
}) {
  const badge = status ? BADGE[status.state] : null
  const connected = status?.state === 'connected' || status?.state === 'attention'

  let action: ReactNode = null
  let note: string | null = null
  if (canOpen) {
    action = (
      <Button
        size="sm"
        variant={connected ? 'outline' : 'default'}
        onClick={onOpen}
        className="after:absolute after:inset-0"
      >
        {service.id === 'my-ai-app' ? '연결 방법' : connected ? '관리' : '연결하기'}
      </Button>
    )
  } else if (service.kind === 'deck-link' && isAdmin && service.href) {
    action = (
      <Button asChild size="sm" variant="outline" className="after:absolute after:inset-0">
        <Link href={service.href}>업무 설정 →</Link>
      </Button>
    )
  } else {
    note = service.id.startsWith('coupang-') ? '관리자가 관리합니다.' : '관리자에게 요청'
  }

  return (
    <li className="relative flex items-start gap-3 rounded-lg border bg-card p-4">
      <ServiceLogo logo={service.logo} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">{service.name}</h3>
          {badge && (
            <Badge variant="outline" className={badge.className}>
              {badge.label}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{service.description}</p>
        {status?.summary && status.state !== 'attention' && (
          <p className="text-xs text-muted-foreground">{status.summary}</p>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  )
}
