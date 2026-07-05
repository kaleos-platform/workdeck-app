'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Template = { id: string; title: string; content: string; updatedAt: string }

export function TemplatesManager() {
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/hiring-applicants/message-templates')
      if (!res.ok) throw new Error()
      const d = await res.json()
      setItems(d.items ?? [])
    } catch {
      toast.error('목록을 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  function startNew() {
    setEditingId('new')
    setTitle('')
    setContent('')
  }

  function startEdit(t: Template) {
    setEditingId(t.id)
    setTitle(t.title)
    setContent(t.content)
  }

  async function save() {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      const isNew = editingId === 'new'
      const res = await fetch(
        isNew
          ? '/api/hiring-applicants/message-templates'
          : `/api/hiring-applicants/message-templates/${editingId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        }
      )
      if (!res.ok) throw new Error()
      setEditingId(null)
      toast.success('저장했습니다')
      load()
    } catch {
      toast.error('저장에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/hiring-applicants/message-templates/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.filter((t) => t.id !== id))
    } catch {
      toast.error('삭제에 실패했습니다')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={startNew} disabled={editingId === 'new'}>
          <Plus className="mr-1 size-4" />새 템플릿
        </Button>
      </div>

      {editingId === 'new' && (
        <TemplateEditor
          title={title}
          content={content}
          onTitle={setTitle}
          onContent={setContent}
          onCancel={() => setEditingId(null)}
          onSave={save}
          saving={saving}
        />
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : items.length === 0 && editingId !== 'new' ? (
        <p className="text-sm text-muted-foreground">등록된 템플릿이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {items.map((t) =>
            editingId === t.id ? (
              <TemplateEditor
                key={t.id}
                title={title}
                content={content}
                onTitle={setTitle}
                onContent={setContent}
                onCancel={() => setEditingId(null)}
                onSave={save}
                saving={saving}
              />
            ) : (
              <Card key={t.id}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-sm">{t.title}</CardTitle>
                  <div className="flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => startEdit(t)}
                      aria-label="수정"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => remove(t.id)}
                      disabled={busyId === t.id}
                      aria-label="삭제"
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{t.content}</p>
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({
  title,
  content,
  onTitle,
  onContent,
  onCancel,
  onSave,
  saving,
}: {
  title: string
  content: string
  onTitle: (v: string) => void
  onContent: (v: string) => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">제목</label>
          <Input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="템플릿 제목"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">내용</label>
          <Textarea
            value={content}
            onChange={(e) => onContent(e.target.value)}
            rows={5}
            placeholder="알림에 채워질 메시지 내용"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving || !title.trim() || !content.trim()}>
            {saving && <Loader2 className="mr-1 size-4 animate-spin" />}
            저장
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
