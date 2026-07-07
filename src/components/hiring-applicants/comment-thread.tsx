'use client'

import { useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type Comment = {
  id: string
  userId: string
  content: string
  createdAt: string
  editedAt: string | null
}

type Props = {
  applicationId: string
  currentUserId: string
  initial: Comment[]
}

// 내부 코멘트(팀 메모) — 본인 코멘트만 수정/삭제.
export function CommentThread({ applicationId, currentUserId, initial }: Props) {
  const [comments, setComments] = useState<Comment[]>(initial)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function add() {
    const content = draft.trim()
    if (!content) return
    setPosting(true)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/${applicationId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('등록 실패')
      const { comment } = (await res.json()) as { comment: Comment }
      setComments((prev) => [...prev, comment])
      setDraft('')
    } catch {
      toast.error('코멘트 등록에 실패했습니다')
    } finally {
      setPosting(false)
    }
  }

  async function saveEdit(id: string) {
    const content = editDraft.trim()
    if (!content) return
    setBusyId(id)
    try {
      const res = await fetch(
        `/api/hiring-applicants/applications/${applicationId}/comments/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        }
      )
      if (!res.ok) throw new Error('수정 실패')
      const { comment } = (await res.json()) as { comment: Comment }
      setComments((prev) => prev.map((c) => (c.id === id ? comment : c)))
      setEditingId(null)
    } catch {
      toast.error('코멘트 수정에 실패했습니다')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(
        `/api/hiring-applicants/applications/${applicationId}/comments/${id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('삭제 실패')
      setComments((prev) => prev.filter((c) => c.id !== id))
    } catch {
      toast.error('코멘트 삭제에 실패했습니다')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">아직 코멘트가 없습니다.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-md border p-3 text-sm">
              {editingId === c.id ? (
                <div className="space-y-2">
                  <Textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      취소
                    </Button>
                    <Button size="sm" onClick={() => saveEdit(c.id)} disabled={busyId === c.id}>
                      {busyId === c.id && <Loader2 className="mr-1 size-3.5 animate-spin" />}
                      저장
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap">{c.content}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleString('ko-KR')}
                      {c.editedAt && ' (수정됨)'}
                    </span>
                    {c.userId === currentUserId && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setEditingId(c.id)
                            setEditDraft(c.content)
                          }}
                          aria-label="수정"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => remove(c.id)}
                          disabled={busyId === c.id}
                          aria-label="삭제"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="내부 코멘트를 남기세요 (지원자에게 보이지 않습니다)"
          rows={2}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={add} disabled={posting || !draft.trim()}>
            {posting && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            코멘트 추가
          </Button>
        </div>
      </div>
    </div>
  )
}
