'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AttentionItem, IntegrationTab } from '@/lib/integrations/attention'
import { AgentToggleCard } from './agent-toggle-card'
import { AgentTokensCard } from './agent-tokens-card'
import { CoupangApiCard } from './coupang-api-card'
import { McpGuideCard } from './mcp-guide-card'
import { SlackConnectCard } from './slack-connect-card'
import { SpaceSecretsCard } from './space-secrets-card'

const TABS: { value: IntegrationTab; label: string }[] = [
  { value: 'services', label: '외부 서비스' },
  { value: 'agents', label: '에이전트' },
  { value: 'secrets', label: '비밀값' },
]

/** 탭을 옮겨도 입력 중인 값과 한 번만 보이는 토큰이 사라지지 않게 카드를 마운트한 채 둔다(forceMount). */
export function IntegrationsTabs({
  attention,
  slackStatus,
  tab,
}: {
  attention: AttentionItem[]
  slackStatus: string | null
  /** 다른 화면의 링크가 지정한 탭(?tab=). 건수보다 우선한다. */
  tab?: string
}) {
  const router = useRouter()
  const refreshAttention = useCallback(() => router.refresh(), [router])
  // 건수와 안내는 갱신하되, 보고 있는 카드가 튀지 않게 정렬은 처음 값으로 고정한다.
  const [initialAttention] = useState(attention)

  const cards: Record<IntegrationTab, { id: string; node: ReactNode }[]> = {
    services: [
      { id: 'slack', node: <SlackConnectCard slackStatus={slackStatus} /> },
      { id: 'coupang', node: <CoupangApiCard onChanged={refreshAttention} /> },
    ],
    agents: [
      { id: 'agent-toggle', node: <AgentToggleCard /> },
      { id: 'agent-tokens', node: <AgentTokensCard onChanged={refreshAttention} /> },
      { id: 'mcp-guide', node: <McpGuideCard /> },
    ],
    secrets: [{ id: 'space-secrets', node: <SpaceSecretsCard onChanged={refreshAttention} /> }],
  }

  return (
    <Tabs
      defaultValue={
        TABS.find((t) => t.value === tab)?.value ??
        (slackStatus ? 'services' : (attention[0]?.tab ?? 'services'))
      }
    >
      <TabsList className="w-full sm:w-fit">
        {TABS.map(({ value, label }) => {
          const count = attention.filter((a) => a.tab === value).length
          return (
            <TabsTrigger key={value} value={value}>
              {label}
              {count > 0 && (
                <Badge variant="destructive" aria-label={`확인 필요 ${count}건`}>
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          )
        })}
      </TabsList>

      {TABS.map(({ value }) => {
        const items = attention.filter((a) => a.tab === value)
        const hasIssue = (id: string) => initialAttention.some((a) => a.cardId === id)
        const sorted = [...cards[value]].sort(
          (a, b) => Number(hasIssue(b.id)) - Number(hasIssue(a.id))
        )
        return (
          <TabsContent
            key={value}
            value={value}
            forceMount
            className="mt-4 grid gap-6 data-[state=inactive]:hidden"
          >
            {items.length > 0 && (
              <Alert role="status">
                <AlertTitle>확인 필요 {items.length}건</AlertTitle>
                <AlertDescription>
                  <ul className="w-full divide-y">
                    {items.map((item) => (
                      <li
                        key={item.message}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="line-clamp-2 min-w-0 break-words">{item.message}</span>
                        <Button asChild size="sm" variant="outline" className="shrink-0">
                          <a href={`#${item.cardId}`}>해결하기</a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {sorted.map(({ id, node }) => (
              <div key={id} id={id} className="min-w-0 scroll-mt-6">
                {node}
              </div>
            ))}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
