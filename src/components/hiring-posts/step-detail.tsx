'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { WizardContentData } from './build-types'

type Props = {
  postingId: string
  initialContents: WizardContentData[]
}

export function StepDetail({ postingId, initialContents }: Props) {
  const router = useRouter()
  const [contents, setContents] = useState(initialContents)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  async function handleAddBlock() {
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: 'text' }),
      })
      if (!res.ok) throw new Error('블록 추가에 실패했습니다')
      const { content } = await res.json()
      setContents((prev) => [...prev, content])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '블록 추가에 실패했습니다')
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
          공고 상세 블록을 편집합니다. 저장 시 공개 페이지에 노출됩니다.
        </p>
        <Button size="sm" onClick={handleAddBlock}>
          <Plus /> 블록 추가
        </Button>
      </div>

      {contents.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          상세 블록이 없습니다. &quot;블록 추가&quot;로 블록을 만드세요.
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
            {/* Phase 3에서 ContentBlockEditor로 대체 */}
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
