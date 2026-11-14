'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Trash2, Check, X, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  TemplateGallery,
  TemplatePreviewPane,
  useTemplateBlockStore,
  type TemplateRow,
} from './template-gallery'

export type { TemplateRow }

export function TemplatesManager({ initialTemplates }: { initialTemplates: TemplateRow[] }) {
  const router = useRouter()
  const busyRef = useRef(false)
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const store = useTemplateBlockStore()
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewing = templates.find((t) => t.id === previewId) ?? null

  function openEdit(t: TemplateRow) {
    if (busyRef.current) return
    setName(t.name)
    setEditingId(t.id)
  }

  async function handleRename() {
    if (busyRef.current || !editingId) return
    if (!name.trim()) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/templates/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error('이름 변경에 실패했습니다')
      const { template } = await res.json()
      setTemplates((current) =>
        current.map((row) =>
          row.id === template.id
            ? { ...row, name: template.name, updatedAt: template.updatedAt }
            : row
        )
      )
      setEditingId(null)
      router.refresh()
      toast.success('템플릿 이름을 변경했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이름 변경에 실패했습니다')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (busyRef.current) return
    if (!confirm('이 템플릿을 삭제할까요?')) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      setTemplates((current) => current.filter((row) => row.id !== id))
      if (editingId === id) setEditingId(null)
      router.refresh()
      toast.success('템플릿을 삭제했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <TemplateGallery
        templates={templates}
        store={store}
        onSelect={(t) => setPreviewId(t.id)}
        renderTitle={(t) =>
          editingId === t.id ? (
            <div className="flex items-center gap-1">
              <Input
                aria-label="템플릿 이름"
                disabled={busy}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8"
              />
              <Button
                aria-label="이름 저장"
                size="icon-sm"
                variant="ghost"
                onClick={handleRename}
                disabled={busy}
              >
                <Check />
              </Button>
              <Button
                disabled={busy}
                aria-label="이름 변경 취소"
                size="icon-sm"
                variant="ghost"
                onClick={() => setEditingId(null)}
              >
                <X />
              </Button>
            </div>
          ) : undefined
        }
        renderActions={(t) => (
          <>
            <Button size="sm" variant="ghost" onClick={() => setPreviewId(t.id)}>
              <Eye /> 미리보기
            </Button>
            {t.isSample ? (
              <span className="ml-auto text-xs text-muted-foreground">읽기 전용</span>
            ) : (
              <span className="ml-auto flex">
                <Button
                  disabled={busy}
                  aria-label={`${t.name} 이름 변경`}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => openEdit(t)}
                >
                  <Pencil />
                </Button>
                <Button
                  disabled={busy}
                  aria-label={`${t.name} 삭제`}
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => handleDelete(t.id)}
                >
                  <Trash2 />
                </Button>
              </span>
            )}
          </>
        )}
      />
      <Dialog open={!!previewing} onOpenChange={(open) => !open && setPreviewId(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewing?.name ?? '템플릿 미리보기'}</DialogTitle>
            <DialogDescription>
              {previewing?.isSample
                ? '워크덱이 제공하는 읽기 전용 템플릿입니다.'
                : '내가 저장한 템플릿의 블록 미리보기입니다.'}
            </DialogDescription>
          </DialogHeader>
          {previewing && (
            <TemplatePreviewPane store={store} template={previewing} className="h-[60vh]" />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
