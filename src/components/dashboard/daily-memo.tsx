'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, StickyNote } from 'lucide-react'
import { MemoDialog } from './memo-dialog'
import type { DailyMemo as DailyMemoType } from '@/types'

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

  // 팝업 상태: null이면 닫힘, { date, content } 이면 열림
  const [dialogState, setDialogState] = useState<{
    open: boolean
    date: string
    initialContent: string
  }>({ open: false, date: '', initialContent: '' })

  // initialMemos 변경 시 동기화
  useEffect(() => {
    setMemos(initialMemos)
  }, [initialMemos])

  // 차트 클릭 등 외부에서 날짜 지정 시 자동으로 팝업 열기
  useEffect(() => {
    if (targetDate) {
      const existing = memos.find((m) => m.date === targetDate)
      setDialogState({
        open: true,
        date: targetDate,
        initialContent: existing?.content ?? '',
      })
    }
  }, [targetDate]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateMemos(newMemos: DailyMemoType[]) {
    setMemos(newMemos)
    onMemosChange?.(newMemos)
  }

  // "메모 추가" 버튼 — 오늘 날짜, 신규 모드
  function openAddDialog() {
    const today = new Date().toISOString().split('T')[0]
    setDialogState({ open: true, date: today, initialContent: '' })
  }

  // 행 클릭 — 수정 모드
  function openEditDialog(memo: DailyMemoType) {
    setDialogState({ open: true, date: memo.date, initialContent: memo.content })
  }

  // 저장 완료 콜백
  function handleSaved(saved: DailyMemoType) {
    const exists = memos.find((m) => m.date === saved.date)
    const newMemos = exists
      ? memos.map((m) => (m.date === saved.date ? saved : m))
      : [...memos, saved].sort((a, b) => b.date.localeCompare(a.date))
    updateMemos(newMemos)
  }

  // 삭제 완료 콜백
  function handleDeleted() {
    updateMemos(memos.filter((m) => m.date !== dialogState.date))
  }

  // 기간 내 메모만 표시 (from/to 필터)
  const filteredMemos = memos
    .filter((m) => {
      if (from && m.date < from) return false
      if (to && m.date > to) return false
      return true
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const editingMemo = memos.find((m) => m.date === dialogState.date)

  return (
    <div className="space-y-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {filteredMemos.length > 0
            ? `${filteredMemos.length}개의 메모${from || to ? ' (기간 내)' : ''}`
            : '메모가 없습니다'}
        </p>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={openAddDialog}>
          <Plus className="h-3.5 w-3.5" />
          메모 추가
        </Button>
      </div>

      {/* 메모 목록 테이블 */}
      {filteredMemos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
          <StickyNote className="h-8 w-8 opacity-30" />
          <p className="text-sm">메모 추가 버튼을 클릭해 메모를 작성하세요</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">날짜</TableHead>
                <TableHead>메모 내용</TableHead>
                <TableHead className="w-28 text-right">마지막 수정일</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMemos.map((memo) => (
                <TableRow
                  key={memo.date}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openEditDialog(memo)}
                >
                  <TableCell className="text-sm font-medium">{memo.date}</TableCell>
                  <TableCell
                    className="max-w-xs truncate text-sm text-muted-foreground"
                    title={memo.content}
                  >
                    {memo.content}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {memo.updatedAt ?? '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 메모 다이얼로그 */}
      <MemoDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        campaignId={campaignId}
        date={dialogState.date}
        initialContent={dialogState.initialContent}
        onSaved={handleSaved}
        onDeleted={editingMemo ? handleDeleted : undefined}
      />
    </div>
  )
}
