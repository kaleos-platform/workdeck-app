'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Trash2, Save } from 'lucide-react'
import type { DailyMemo } from '@/types'

const MAX_CONTENT_LENGTH = 500

interface MemoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignId: string
  // 수정 모드: date 고정 + initialContent 있음
  // 신규 모드: date 변경 가능 + initialContent 없음
  date: string
  initialContent?: string
  onSaved: (memo: DailyMemo) => void
  onDeleted?: () => void
}

export function MemoDialog({
  open,
  onOpenChange,
  campaignId,
  date: dateProp,
  initialContent = '',
  onSaved,
  onDeleted,
}: MemoDialogProps) {
  const isEditMode = !!initialContent
  const [date, setDate] = useState(dateProp)
  const [content, setContent] = useState(initialContent)
  const [isSaving, setIsSaving] = useState(false)

  // 다이얼로그 열릴 때 props에서 상태 초기화
  useEffect(() => {
    if (open) {
      setDate(dateProp)
      setContent(initialContent)
    }
  }, [open, dateProp, initialContent])

  const remaining = MAX_CONTENT_LENGTH - content.length
  const showWarning = remaining < 50
  const today = new Date().toISOString().split('T')[0]

  async function handleSave() {
    if (!date) {
      toast.error('날짜를 선택해주세요')
      return
    }
    if (!content.trim()) {
      toast.error('메모 내용을 입력해주세요')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, content }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.message || '저장에 실패했습니다')
        return
      }

      const saved: DailyMemo = await res.json()
      onSaved(saved)
      onOpenChange(false)
      toast.success('메모가 저장되었습니다')
    } catch {
      toast.error('저장 중 오류가 발생했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDeleted) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/memos?date=${date}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        toast.error('삭제에 실패했습니다')
        return
      }

      onDeleted()
      onOpenChange(false)
      toast.success('메모가 삭제되었습니다')
    } catch {
      toast.error('삭제 중 오류가 발생했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? '메모 수정' : '메모 추가'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 날짜 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">날짜</label>
            {isEditMode ? (
              <p className="text-sm text-muted-foreground">{dateProp}</p>
            ) : (
              <Input
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value)}
                className="w-44 text-sm"
              />
            )}
          </div>

          {/* 내용 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">내용</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="광고 작업 내용, 입찰가 변경 사항, 성과 메모 등을 기록하세요..."
              className="min-h-[120px] resize-none text-sm"
              maxLength={MAX_CONTENT_LENGTH}
            />
            <p className={`text-xs ${showWarning ? 'text-orange-500' : 'text-muted-foreground'}`}>
              {remaining}자 남음
            </p>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {/* 삭제 버튼 (수정 모드에서만) */}
          {isEditMode && onDeleted ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={isSaving}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              삭제
            </Button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              취소
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              {isSaving ? '저장 중...' : '저장'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
