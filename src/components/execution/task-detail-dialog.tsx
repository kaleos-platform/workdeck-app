'use client'

import {
  Trash2,
  TrendingUp,
  Pause,
  Play,
  DollarSign,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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

type TaskDetailDialogProps = {
  task: ExecutionTask | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onTaskUpdate: () => void
}

function StateComparison({
  label,
  state,
}: {
  label: string
  state: Record<string, unknown>
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-40">
        {JSON.stringify(state, null, 2)}
      </pre>
    </div>
  )
}

export function TaskDetailDialog({
  task,
  open,
  onOpenChange,
  onTaskUpdate,
}: TaskDetailDialogProps) {
  if (!task) return null

  const Icon = ACTION_TYPE_ICONS[task.actionType]

  const handleRollback = async () => {
    await fetch(`/api/execution/tasks/${task.id}/rollback`, {
      method: 'POST',
    })
    onOpenChange(false)
    onTaskUpdate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {ACTION_TYPE_LABELS[task.actionType]}
          </DialogTitle>
          <DialogDescription>태스크 상세 정보</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">캠페인</p>
              <p className="text-sm font-medium">{task.campaignId}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">대상</p>
              <p className="text-sm font-medium">{task.target}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">상태</p>
              <Badge
                variant="outline"
                className={cn('border-transparent', STATUS_VARIANT[task.status])}
              >
                {STATUS_LABELS[task.status]}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">생성일</p>
              <p className="text-sm">
                {new Date(task.createdAt).toLocaleString('ko-KR')}
              </p>
            </div>
          </div>

          {task.params && Object.keys(task.params).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">파라미터</p>
              <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-40">
                {JSON.stringify(task.params, null, 2)}
              </pre>
            </div>
          )}

          {task.error && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">오류</p>
              <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {task.error}
              </p>
            </div>
          )}

          {(task.beforeState || task.afterState) && (
            <div className="space-y-3">
              <p className="text-sm font-medium">변경 전/후 비교</p>
              <div className="grid grid-cols-2 gap-3">
                {task.beforeState && (
                  <StateComparison label="변경 전" state={task.beforeState} />
                )}
                {task.afterState && (
                  <StateComparison label="변경 후" state={task.afterState} />
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {task.status === 'COMPLETED' && (
            <Button variant="outline" onClick={handleRollback}>
              롤백
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
