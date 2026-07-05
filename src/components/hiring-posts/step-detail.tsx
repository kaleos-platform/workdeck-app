'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Plus, Trash2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawScene } from './excalidraw-canvas'
import type { WizardContentData } from './build-types'

// Excalidraw 는 브라우저 전용 — 상세 스텝이 활성일 때만 클라이언트에서 마운트
const ExcalidrawCanvas = dynamic(
  () => import('./excalidraw-canvas').then((m) => m.ExcalidrawCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[480px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
        캔버스를 불러오는 중…
      </div>
    ),
  }
)

type Props = {
  postingId: string
  initialContents: WizardContentData[]
}

export function StepDetail({ postingId, initialContents }: Props) {
  const router = useRouter()
  const [contents, setContents] = useState(initialContents)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  async function handleAddBlock() {
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('블록 추가에 실패했습니다')
      const { content } = await res.json()
      setContents((prev) => [...prev, content])
      // 스텝 이동 시 언마운트되므로 서버 props 최신화
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '블록 추가에 실패했습니다')
    }
  }

  async function handleSaveBlock(contentId: string, scene: ExcalidrawScene, imageBase64: string) {
    setSavingId(contentId)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents/${contentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: scene, imageBase64 }),
      })
      if (!res.ok) throw new Error('저장에 실패했습니다')
      const { content } = await res.json()
      setContents((prev) => prev.map((c) => (c.id === contentId ? content : c)))
      toast.success('상세 블록을 저장했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDeleteBlock(contentId: string) {
    if (!confirm('이 상세 블록을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents/${contentId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      setContents((prev) => prev.filter((c) => c.id !== contentId))
      toast.success('블록을 삭제했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    setSavingTemplate(true)
    try {
      const res = await fetch('/api/hiring-posts/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName.trim(), postingId }),
      })
      if (!res.ok) throw new Error('템플릿 저장에 실패했습니다')
      setTemplateName('')
      toast.success('현재 상세를 템플릿으로 저장했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 저장에 실패했습니다')
    } finally {
      setSavingTemplate(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          공고 상세를 캔버스로 그립니다. 저장 시 이미지가 공개 페이지에 노출됩니다.
        </p>
        <Button size="sm" onClick={handleAddBlock}>
          <Plus /> 블록 추가
        </Button>
      </div>

      {contents.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          상세 블록이 없습니다. “블록 추가”로 캔버스를 만드세요.
        </div>
      )}

      <div className="space-y-6">
        {contents.map((c, idx) => (
          <div key={c.id} className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">상세 블록 {idx + 1}</span>
              <Button size="icon-sm" variant="ghost" onClick={() => handleDeleteBlock(c.id)}>
                <Trash2 />
              </Button>
            </div>
            <ExcalidrawCanvas
              initialData={(c.data as ExcalidrawInitialDataState | null) ?? null}
              saving={savingId === c.id}
              onSave={(scene, image) => handleSaveBlock(c.id, scene, image)}
            />
          </div>
        ))}
      </div>

      {contents.length > 0 && (
        <div className="flex items-end gap-2 rounded-lg border bg-muted/30 p-4">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium" htmlFor="tpl-name">
              템플릿으로 저장
            </label>
            <Input
              id="tpl-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="템플릿 이름"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveTemplate}
            disabled={savingTemplate}
          >
            <Save /> 저장
          </Button>
        </div>
      )}
    </div>
  )
}
