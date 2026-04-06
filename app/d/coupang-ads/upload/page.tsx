'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Database, Settings2, UploadCloud } from 'lucide-react'
import { CollectionHistory } from '@/components/settings/collection-history'
import { ScheduleConfig } from '@/components/settings/schedule-config'
import { ReportUploadForm } from '@/components/dashboard/report-upload-form'

export default function DataCollectionPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">데이터 수집</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          쿠팡 광고 데이터를 자동 또는 수동으로 수집합니다.
        </p>
      </div>

      <Tabs defaultValue="auto-collect" className="space-y-6">
        <TabsList>
          <TabsTrigger value="auto-collect" className="gap-1.5">
            <Database className="h-4 w-4" />
            자동 수집
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-1.5">
            <UploadCloud className="h-4 w-4" />
            리포트 업로드
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auto-collect" className="space-y-4">
          {/* 설정 버튼 */}
          <div className="flex justify-end">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Settings2 className="h-4 w-4" />
                  자동 수집 설정
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>자동 수집 설정</DialogTitle>
                </DialogHeader>
                <ScheduleConfig embedded />
              </DialogContent>
            </Dialog>
          </div>

          {/* 수집 이력 */}
          <CollectionHistory />
        </TabsContent>

        <TabsContent value="upload">
          <ReportUploadForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
