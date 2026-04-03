'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TaskQueue } from '@/components/execution/task-queue'
import { SafetyLimitsForm } from '@/components/execution/safety-limits-form'
import type { ExecutionTask } from '@/types/execution'

type TabValue = 'pending' | 'in-progress' | 'done'

const TAB_STATUS_MAP: Record<TabValue, string> = {
  pending: 'PENDING_APPROVAL',
  'in-progress': 'APPROVED,EXECUTING',
  done: 'COMPLETED,FAILED,ROLLED_BACK',
}

export default function ExecutionPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('pending')
  const [tasks, setTasks] = useState<ExecutionTask[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const fetchTasks = useCallback(async (tab: TabValue) => {
    setLoading(true)
    try {
      const statuses = TAB_STATUS_MAP[tab]
      const res = await fetch(`/api/execution/tasks?status=${statuses}`)
      if (res.ok) {
        const data = await res.json()
        setTasks(data)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTasks(activeTab)
  }, [activeTab, fetchTasks])

  const handleTabChange = (value: string) => {
    setActiveTab(value as TabValue)
    setSelectedIds(new Set())
  }

  const handleBatchApprove = async () => {
    if (selectedIds.size === 0) return

    const promises = Array.from(selectedIds).map((id) =>
      fetch(`/api/execution/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APPROVED' }),
      })
    )

    await Promise.allSettled(promises)
    setSelectedIds(new Set())
    fetchTasks(activeTab)
  }

  const handleTaskUpdate = () => {
    fetchTasks(activeTab)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">실행 관리</h1>
          <p className="text-sm text-muted-foreground">
            광고 최적화 작업을 관리하고 승인합니다.
          </p>
        </div>
        {activeTab === 'pending' && selectedIds.size > 0 && (
          <Button onClick={handleBatchApprove}>
            일괄 승인 ({selectedIds.size}건)
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="pending">대기 중</TabsTrigger>
          <TabsTrigger value="in-progress">진행 중</TabsTrigger>
          <TabsTrigger value="done">완료</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <TaskQueue
            tasks={tasks}
            loading={loading}
            selectable
            selectedIds={selectedIds}
            onSelectedChange={setSelectedIds}
            onTaskUpdate={handleTaskUpdate}
            showActions
          />
        </TabsContent>

        <TabsContent value="in-progress">
          <TaskQueue
            tasks={tasks}
            loading={loading}
            onTaskUpdate={handleTaskUpdate}
          />
        </TabsContent>

        <TabsContent value="done">
          <TaskQueue
            tasks={tasks}
            loading={loading}
            onTaskUpdate={handleTaskUpdate}
            showRollback
          />
        </TabsContent>
      </Tabs>

      <SafetyLimitsForm />
    </div>
  )
}
