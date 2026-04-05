'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Bot, Cable, Clock, RefreshCw } from 'lucide-react'
import { CredentialForm } from '@/components/settings/credential-form'
import { ScheduleConfig } from '@/components/settings/schedule-config'
import { CollectionHistory } from '@/components/settings/collection-history'
import { AgentConfig } from '@/components/settings/agent-config'
import { AgentActivityLog } from '@/components/settings/agent-activity-log'

export default function CoupangAdsSettingsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          쿠팡 광고 Deck의 연동, 수집, 에이전트 설정을 관리합니다.
        </p>
      </div>

      <Tabs defaultValue="integration" className="space-y-6">
        <TabsList>
          <TabsTrigger value="integration" className="gap-1.5">
            <Cable className="h-4 w-4" />
            쿠팡 연동
          </TabsTrigger>
          <TabsTrigger value="auto-collect" className="gap-1.5">
            <RefreshCw className="h-4 w-4" />
            자동 수집
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Clock className="h-4 w-4" />
            수집 이력
          </TabsTrigger>
          <TabsTrigger value="agent" className="gap-1.5">
            <Bot className="h-4 w-4" />
            에이전트
          </TabsTrigger>
        </TabsList>

        <TabsContent value="integration">
          <CredentialForm />
        </TabsContent>

        <TabsContent value="auto-collect">
          <ScheduleConfig />
        </TabsContent>

        <TabsContent value="history">
          <CollectionHistory />
        </TabsContent>

        <TabsContent value="agent" className="space-y-6">
          <AgentConfig />
          <AgentActivityLog />
        </TabsContent>
      </Tabs>
    </div>
  )
}
