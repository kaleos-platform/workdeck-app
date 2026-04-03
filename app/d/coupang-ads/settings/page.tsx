'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CredentialForm } from '@/components/settings/credential-form'
import { ScheduleConfig } from '@/components/settings/schedule-config'
import { CollectionHistory } from '@/components/settings/collection-history'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-muted-foreground">
          쿠팡 연동 및 데이터 수집 설정을 관리합니다.
        </p>
      </div>

      <Tabs defaultValue="credentials" className="space-y-6">
        <TabsList>
          <TabsTrigger value="credentials">쿠팡 연동</TabsTrigger>
          <TabsTrigger value="schedule">자동 수집</TabsTrigger>
          <TabsTrigger value="history">수집 이력</TabsTrigger>
        </TabsList>

        <TabsContent value="credentials">
          <CredentialForm />
        </TabsContent>

        <TabsContent value="schedule">
          <ScheduleConfig />
        </TabsContent>

        <TabsContent value="history">
          <CollectionHistory />
        </TabsContent>
      </Tabs>
    </div>
  )
}
