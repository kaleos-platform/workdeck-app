'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Save, Trash2, StickyNote, Plus } from 'lucide-react'
import type { DailyMemo as DailyMemoType } from '@/types'

const MAX_CONTENT_LENGTH = 500

interface DailyMemoProps {
  campaignId: string
  initialMemos?: DailyMemoType[]
  onMemosChange?: (memos: DailyMemoType[]) => void
  from?: string
  to?: string
  targetDate?: string | null
}

export function DailyMemo({
  campaignId,
  initialMemos = [],
  onMemosChange,
  from,
  to,
  targetDate,
}: DailyMemoProps) {
  const [memos, setMemos] = useState<DailyMemoType[]>(initialMemos)
  const [selectedDate, setSelectedDate] = useState('')
  const [content, setContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const forceEditRef = useRef(false)

  // initialMemos 변경 시 동기화
  useEffect(() => {
    setMemos(initialMemos)
  }, [initialMemos])

  // 차트 클릭 등 외부에서 날짜 지정 시 자동 선택
  useEffect(() => {
    if (targetDate) {
      setSelectedDate(targetDate)
    }
  }, [targetDate])

  const currentMemo = memos.find((m) => m.date === selectedDate)

  // 날짜 변경 시 해당 메모 내용 불러오기
  useEffect(() => {
    if (selectedDate) {
      const memo = memos.find((m) => m.date === selectedDate)
      setContent(memo?.content ?? '')
      if (forceEditRef.current) {
        setIsEditing(true)
        forceEditRef.current = false
      } else {
        setIsEditing(false)
      }
    }
  }, [selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateMemos(newMemos: DailyMemoType[]) {
    setMemos(newMemos)
    onMemosChange?.(newMemos)
  }

  // "메모 추가" 버튼 — 오늘 날짜로 편집 모드 진입
  function openAddForm() {
    const today = new Date().toISOString().split('T')[0]
    forceEditRef.current = true
    setSelectedDate(today)
  }

  async function handleSave() {
    if (!selectedDate) {
      toast.error('날짜를 선택해주세요')
      return
    }
    if (!content.trim()) {
      toast.error('메모 내용을 입력해주세요')
      return
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      toast.error(`${MAX_CONTENT_LENGTH}자 이하로 입력해주세요`)
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/memos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate, content }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.message || '저장에 실패했습니다')
        return
      }

      const saved: DailyMemoType = await res.json()
      const newMemos = memos.find((m) => m.date === selectedDate)
        ? memos.map((m) => (m.date === selectedDate ? { ...saved, date: selectedDate } : m))
        : [...memos, { ...saved, date: selectedDate }]

      updateMemos(newMemos)
      setIsEditing(false)
      toast.success('메모가 저장되었습니다')
    } catch {
      toast.error('저장 중 오류가 발생했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete() {
    if (!currentMemo) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/memos?date=${selectedDate}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        toast.error('삭제에 실패했습니다')
        return
      }

      updateMemos(memos.filter((m) => m.date !== selectedDate))
      setContent('')
      setIsEditing(false)
      toast.success('메모가 삭제되었습니다')
    } catch {
      toast.error('삭제 중 오류가 발생했습니다')
    } finally {
      setIsSaving(false)
    }
  }

  function handleEdit() {
    setIsEditing(true)
  }

  function handleCancel() {
    setContent(currentMemo?.content ?? '')
    setIsEditing(false)
  }

  const today = new Date().toISOString().split('T')[0]
  const remaining = MAX_CONTENT_LENGTH - content.length
  const showWarning = remaining < 50

  // 기간 내 메모만 표시 (from/to 필터 적용)
  const filteredMemos = memos.filter((m) => {
    if (from && m.date < from) return false
    if (to && m.date > to) return false
    return true
  })

  return (
    <div className="space-y-4">
      {/* 헤더: 날짜 선택 + 메모 추가 버튼 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm whitespace-nowrap text-muted-foreground">날짜 선택</label>
          <Input
            type="date"
            value={selectedDate}
            max={today}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-40 text-sm"
          />
          {selectedDate && currentMemo && (
            <Badge variant="secondary" className="text-xs">
              <StickyNote className="mr-1 h-3 w-3" />
              메모 있음
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={openAddForm}>
          <Plus className="h-3.5 w-3.5" />
          메모 추가
        </Button>
      </div>

      {/* 날짜 미선택 안내 */}
      {!selectedDate && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
          <StickyNote className="h-8 w-8 opacity-30" />
          <p className="text-sm">날짜를 선택하거나 메모 추가를 눌러 시작하세요</p>
        </div>
      )}

      {/* 메모 표시/편집 영역 */}
      {selectedDate && (
        <div className="space-y-3">
          {/* 조회 모드 */}
          {!isEditing && currentMemo && (
            <div className="space-y-3">
              <div className="min-h-[80px] rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {currentMemo.content}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleEdit} disabled={isSaving}>
                  수정
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={isSaving}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  삭제
                </Button>
              </div>
            </div>
          )}

          {/* 빈 상태 (메모 없음) */}
          {!isEditing && !currentMemo && (
            <div className="space-y-3">
              <div className="rounded-md border border-dashed p-4 text-center">
                <p className="mb-3 text-sm text-muted-foreground">
                  {selectedDate} 날짜에 메모가 없습니다
                </p>
                <Button size="sm" onClick={() => setIsEditing(true)}>
                  메모 작성
                </Button>
              </div>
            </div>
          )}

          {/* 편집 모드 */}
          {isEditing && (
            <div className="space-y-2">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="광고 작업 내용, 입찰가 변경 사항, 성과 메모 등을 기록하세요..."
                className="min-h-[120px] resize-none text-sm"
                maxLength={MAX_CONTENT_LENGTH}
              />
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${showWarning ? 'text-orange-500' : 'text-muted-foreground'}`}
                >
                  {remaining}자 남음
                </span>
                <div className="flex gap-2">
                  {currentMemo && (
                    <Button size="sm" variant="outline" onClick={handleCancel} disabled={isSaving}>
                      취소
                    </Button>
                  )}
                  <Button size="sm" onClick={handleSave} className="gap-1.5" disabled={isSaving}>
                    <Save className="h-3.5 w-3.5" />
                    {isSaving ? '저장 중...' : '저장'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 기간 내 메모 목록 요약 */}
      {filteredMemos.length > 0 && (
        <div className="border-t pt-2">
          <p className="mb-2 text-xs text-muted-foreground">
            메모 작성 날짜{from || to ? ' (기간 내)' : ''}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {filteredMemos
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((memo) => (
                <button
                  key={memo.date}
                  onClick={() => setSelectedDate(memo.date)}
                  className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                    selectedDate === memo.date
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:border-primary'
                  }`}
                >
                  {memo.date}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
