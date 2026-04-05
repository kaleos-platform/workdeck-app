'use client'

import { useState } from 'react'
import {
  Trash2,
  TrendingUp,
  Pause,
  Play,
  DollarSign,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TaskDetailDialog } from '@/components/execution/task-detail-dialog'
import { cn } from '@/lib/utils'
import type { ActionType, ExecutionStatus, ExecutionTask } from '@/types/execution'

const ACTION_TYPE_ICONS: Record<ActionType, React.ElementType> = {
  REMOVE_KEYWORD: Trash2,
  ADJUST_BID: TrendingUp,
  PAUSE_CAMPAIGN: Pause,
  RESUME_CAMPAIGN: Play,
  ADJUST_BUDGET: DollarSign,
}

const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  REMOVE_KEYWORD: '키워드 제거',
  ADJUST_BID: '입찰가 조정',
  PAUSE_CAMPAIGN: '캠페인 일시정지',
  RESUME_CAMPAIGN: '캠페인 재개',
  ADJUST_BUDGET: '예산 조정',
}

const STATUS_VARIANT: Record<ExecutionStatus, string> = {
  PENDING_APPROVAL: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  EXECUTING: 'bg-indigo-100 text-indigo-800',
  COMPLETED: 'bg-green-100 text-green-800',
  FAILED: 'bg-red-100 text-red-800',
  ROLLED_BACK: 'bg-gray-100 text-gray-800',
}

const STATUS_LABELS: Record<ExecutionStatus, string> = {
  PENDING_APPROVAL: '대기 중',
  APPROVED: '승인됨',
  EXECUTING: '실행 중',
  COMPLETED: '완료',
  FAILED: '실패',
  ROLLED_BACK: '롤백됨',
}

type TaskQueueProps = {
  tasks: ExecutionTask[]
  loading: boolean
  selectable?: boolean
  selectedIds?: Set<string>
  onSelectedChange?: (ids: Set<string>) => void
  onTaskUpdate: () => void
  showActions?: boolean
  showRollback?: boolean
}

export function TaskQueue({
  tasks,
  loading,
  selectable = false,
  selectedIds = new Set(),
  onSelectedChange,
  onTaskUpdate,
  showActions = false,
  showRollback = false,
}: TaskQueueProps) {
  const [detailTask, setDetailTask] = useState<ExecutionTask | null>(null)

  const toggleSelect = (id: string) => {
    if (!onSelectedChange) return
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onSelectedChange(next)
  }

  const toggleSelectAll = () => {
    if (!onSelectedChange) return
    if (selectedIds.size === tasks.length) {
      onSelectedChange(new Set())
    } else {
      onSelectedChange(new Set(tasks.map((t) => t.id)))
    }
  }

  const handleAction = async (taskId: string, status: 'APPROVED' | 'REJECTED') => {
    await fetch(`/api/execution/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    onTaskUpdate()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">태스크가 없습니다.</p>
      </div>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedIds.size === tasks.length && tasks.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
            )}
            <TableHead>유형</TableHead>
            <TableHead>캠페인</TableHead>
            <TableHead>대상</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>생성일</TableHead>
            <TableHead>액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const Icon = ACTION_TYPE_ICONS[task.actionType]
            return (
              <TableRow
                key={task.id}
                className="cursor-pointer"
                onClick={() => setDetailTask(task)}
              >
                {selectable && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(task.id)}
                      onCheckedChange={() => toggleSelect(task.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {ACTION_TYPE_LABELS[task.actionType]}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{task.campaignId}</TableCell>
                <TableCell>{task.target}</TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={cn('border-transparent', STATUS_VARIANT[task.status])}
                  >
                    {STATUS_LABELS[task.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(task.createdAt).toLocaleDateString('ko-KR')}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    {showActions && task.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleAction(task.id, 'APPROVED')}
                        >
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleAction(task.id, 'REJECTED')}
                        >
                          거부
                        </Button>
                      </>
                    )}
                    {showRollback && task.status === 'COMPLETED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await fetch(`/api/execution/tasks/${task.id}/rollback`, {
                            method: 'POST',
                          })
                          onTaskUpdate()
                        }}
                      >
                        롤백
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <TaskDetailDialog
        task={detailTask}
        open={!!detailTask}
        onOpenChange={(open) => {
          if (!open) setDetailTask(null)
        }}
        onTaskUpdate={onTaskUpdate}
      />
    </>
  )
}
