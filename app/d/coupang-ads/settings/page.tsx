'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Bell, Bot, Cable, RefreshCw } from 'lucide-react'
import { CredentialForm } from '@/components/settings/credential-form'
import { ScheduleConfig } from '@/components/settings/schedule-config'
import { AnalysisSchedule } from '@/components/analysis/analysis-schedule'
import { AgentConfig } from '@/components/settings/agent-config'
import { AgentScheduledMessages } from '@/components/settings/agent-scheduled-messages'
import { AgentActivityLog } from '@/components/settings/agent-activity-log'
import { cn } from '@/lib/utils'

function StatusDot({ active }: { active: boolean | null }) {
  if (active === null) return null
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        active ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600',
      )}
    />
  )
}

export default function CoupangAdsSettingsPage() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'agent'
  const [activeTab, setActiveTab] = useState(initialTab)

  // 탭 활성화 상태
  const [agentActive, setAgentActive] = useState<boolean | null>(null)
  const [scheduleActive, setScheduleActive] = useState<boolean | null>(null)
  const [credentialActive, setCredentialActive] = useState<boolean | null>(null)

  useEffect(() => {
    // 3개 API 병렬 호출로 활성화 상태 확인
    Promise.all([
      fetch('/api/deck-agents').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/collection/schedule').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/collection/credentials').then((r) => (r.ok ? r.json() : null)),
    ]).then(([agentData, scheduleData, credData]) => {
      const agent = agentData?.agent
      setAgentActive(agent?.enabled ?? false)
      setScheduleActive(scheduleData?.schedule?.enabled ?? false)
      setCredentialActive(credData?.isConnected ?? false)
    }).catch(() => {})
  }, [])

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          쿠팡 광고 Deck의 연동, 수집, 에이전트 설정을 관리합니다.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="agent" className="gap-1.5">
            <Bot className="h-4 w-4" />
            에이전트
            <StatusDot active={agentActive} />
          </TabsTrigger>
          <TabsTrigger value="scheduled-tasks" className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            예약 작업
            <StatusDot active={scheduleActive} />
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5">
            <Bell className="h-4 w-4" />
            알림
          </TabsTrigger>
          <TabsTrigger value="integration" className="gap-1.5">
            <Cable className="h-4 w-4" />
            쿠팡 연동
            <StatusDot active={credentialActive} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="agent" className="space-y-6">
          <AgentConfig />
          <AgentActivityLog />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <AgentScheduledMessages onNavigateTab={setActiveTab} />
        </TabsContent>

        <TabsContent value="scheduled-tasks" className="space-y-6">
          <ScheduleConfig />
          <AnalysisSchedule />
        </TabsContent>

        <TabsContent value="integration">
          <CredentialForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
