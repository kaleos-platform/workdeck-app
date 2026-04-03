'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Bot, Cable, Clock, RefreshCw } from 'lucide-react'
import { AgentConfig } from '@/components/settings/agent-config'
import { AgentActivityLog } from '@/components/settings/agent-activity-log'

function PlaceholderTab({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            이 기능은 준비 중입니다.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

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
          <PlaceholderTab
            icon={Cable}
            title="쿠팡 연동 설정"
            description="쿠팡 광고 API 연동 정보를 관리합니다."
          />
        </TabsContent>

        <TabsContent value="auto-collect">
          <PlaceholderTab
            icon={RefreshCw}
            title="자동 수집 설정"
            description="광고 데이터 자동 수집 스케줄을 관리합니다."
          />
        </TabsContent>

        <TabsContent value="history">
          <PlaceholderTab
            icon={Clock}
            title="수집 이력"
            description="데이터 수집 이력을 확인합니다."
          />
        </TabsContent>

        <TabsContent value="agent" className="space-y-6">
          <AgentConfig />
          <AgentActivityLog />
        </TabsContent>
      </Tabs>
    </div>
  )
}
