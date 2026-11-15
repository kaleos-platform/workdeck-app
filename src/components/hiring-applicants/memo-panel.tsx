'use client'

import { useState } from 'react'
import { ChevronRight, StickyNote } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { CommentThread, type Comment } from '@/components/hiring-applicants/comment-thread'

type Props = {
  applicationId: string
  currentUserId: string
  initial: Comment[]
  legacyMemo?: string | null
}

// 메모 — 데스크톱(lg)은 우측 sticky 패널, 모바일은 요약 한 줄 + 하단 Sheet. 두 곳이 같은 상태를 공유한다.
export function MemoPanel({ applicationId, currentUserId, initial, legacyMemo }: Props) {
  const [comments, setComments] = useState<Comment[]>(initial)
  const [open, setOpen] = useState(false)
  const count = comments.length + (legacyMemo ? 1 : 0)
  const recent = comments.length ? comments[comments.length - 1].content : (legacyMemo ?? '')
  const thread = (
    <CommentThread
      applicationId={applicationId}
      currentUserId={currentUserId}
      initial={initial}
      legacyMemo={legacyMemo}
      comments={comments}
      onCommentsChange={setComments}
    />
  )

  return (
    <div className="order-first lg:sticky lg:top-4 lg:order-none lg:self-start">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm lg:hidden"
        onClick={() => setOpen(true)}
      >
        <StickyNote className="size-4 shrink-0 text-muted-foreground" />
        {count === 0 ? (
          <span>메모 남기기</span>
        ) : (
          <>
            <span className="shrink-0 font-medium">메모 {count}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">· 최근: {recent}</span>
          </>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      <section className="hidden min-h-0 flex-col gap-3 rounded-lg border p-4 lg:flex lg:max-h-[calc(100dvh-6rem)]">
        <h2 className="text-sm font-semibold">메모</h2>
        {thread}
      </section>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>메모</SheetTitle>
            <SheetDescription>팀 내부 메모입니다. 지원자에게 보이지 않습니다.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">{open && thread}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
