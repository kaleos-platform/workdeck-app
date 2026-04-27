'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Editor } from '@/components/sc/editor/editor'
import { ImagePicker } from '@/components/sc/editor/image-picker'
import { ContentStatusBadge } from './content-status-badge'

type Status = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'ANALYZED'

type Props = {
  contentId: string
  initialTitle: string
  initialDoc: unknown
  status: Status
  nextAllowed: Status[]
}

const TRANSITION_LABEL: Record<Status, string> = {
  DRAFT: '초안으로 되돌리기',
  IN_REVIEW: '검토 요청',
  APPROVED: '승인',
  SCHEDULED: '예약',
  PUBLISHED: '게시됨으로 표시',
  ANALYZED: '분석 완료',
}

export function ContentEditor({ contentId, initialTitle, initialDoc, status, nextAllowed }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [doc, setDoc] = useState<unknown>(initialDoc)
  const [saving, setSaving] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const editable = status === 'DRAFT' || status === 'IN_REVIEW' || status === 'APPROVED'

  async function save() {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/api/sc/contents/${contentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, doc }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '저장 실패')
        return
      }
      setMessage('저장 완료')
    } finally {
      setSaving(false)
    }
  }

  async function doTransition(to: Status) {
    setTransitioning(true)
    setError(null)
    setMessage(null)
    try {
      // 현재 변경사항 먼저 저장
      await fetch(`/api/sc/contents/${contentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, doc }),
      })
      const res = await fetch(`/api/sc/contents/${contentId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '전이 실패')
        return
      }
      setMessage(`상태 전이 완료: ${to}`)
      router.refresh()
    } finally {
      setTransitioning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ContentStatusBadge status={status} />
        {!editable && (
          <span className="text-xs text-muted-foreground">
            이 상태에서는 직접 편집할 수 없습니다. DRAFT 로 되돌린 후 수정하세요.
          </span>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">제목</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="title" className="sr-only">
            제목
          </Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!editable}
            maxLength={300}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">본문</CardTitle>
        </CardHeader>
        <CardContent>
          <Editor initialDoc={doc} editable={editable} onChange={setDoc} />
        </CardContent>
      </Card>

      {editable && <ImagePicker contentId={contentId} />}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && !error && (
        <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {nextAllowed.map((next) => (
            <Button
              key={next}
              variant="outline"
              size="sm"
              onClick={() => doTransition(next)}
              disabled={transitioning || saving}
            >
              {TRANSITION_LABEL[next]}
            </Button>
          ))}
        </div>
        <Button onClick={save} disabled={!editable || saving || transitioning}>
          {saving ? '저장 중…' : '저장'}
        </Button>
      </div>
    </div>
  )
}
