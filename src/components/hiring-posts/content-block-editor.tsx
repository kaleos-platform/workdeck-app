'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, ArrowUp, ArrowDown, Type, ImageIcon, Upload, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Editor } from '@/components/sc/editor/editor'
import { getPostingAssetPublicUrl, type WizardContentData } from './build-types'

type Props = {
  postingId: string
  contents: WizardContentData[]
  onChange: (contents: WizardContentData[]) => void
}

export function ContentBlockEditor({ postingId, contents, onChange }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  // 텍스트 블록별 debounce 타이머 (data 저장)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  async function patchContent(contentId: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents/${contentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('저장에 실패했습니다')
    return (await res.json()).content as WizardContentData
  }

  async function handleAdd(contentType: 'text' | 'image') {
    setBusy(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType }),
      })
      if (!res.ok) throw new Error('블록 추가에 실패했습니다')
      const { content } = await res.json()
      onChange([...contents, content])
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '블록 추가에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(contentId: string) {
    if (!confirm('이 블록을 삭제할까요?')) return
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents/${contentId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      onChange(contents.filter((c) => c.id !== contentId))
      toast.success('블록을 삭제했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  // 인접 블록 순서 교환 + 양쪽 sortOrder PATCH
  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= contents.length) return
    const next = [...contents]
    ;[next[index], next[target]] = [next[target], next[index]]
    // sortOrder 를 배열 인덱스로 재정규화
    const reordered = next.map((c, i) => ({ ...c, sortOrder: i }))
    onChange(reordered)
    try {
      await Promise.all([
        patchContent(reordered[index].id, { sortOrder: reordered[index].sortOrder }),
        patchContent(reordered[target].id, { sortOrder: reordered[target].sortOrder }),
      ])
      router.refresh()
    } catch {
      toast.error('순서 변경 저장에 실패했습니다')
    }
  }

  // 텍스트 편집 → 로컬 즉시 반영 + debounce(700ms) PATCH
  function handleTextChange(contentId: string, doc: unknown) {
    onChange(contents.map((c) => (c.id === contentId ? { ...c, data: doc } : c)))
    clearTimeout(timers.current[contentId])
    timers.current[contentId] = setTimeout(() => {
      patchContent(contentId, { data: doc }).catch(() => toast.error('본문 저장에 실패했습니다'))
    }, 700)
  }

  async function handleImageSelect(contentId: string, file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
      reader.readAsDataURL(file)
    })
    try {
      const updated = await patchContent(contentId, {
        imageBase64: dataUrl,
        mimeType: file.type || undefined,
      })
      onChange(
        contents.map((c) => (c.id === contentId ? { ...c, imagePath: updated.imagePath } : c))
      )
      toast.success('이미지를 업로드했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다')
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
    <div className="space-y-4">
      {contents.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          공고를 꾸밀 블록이 없습니다. 아래에서 블록을 추가하세요.
        </div>
      )}

      <div className="space-y-4">
        {contents.map((c, idx) => (
          <div key={c.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                {c.contentType === 'image' ? (
                  <ImageIcon className="size-4 text-muted-foreground" />
                ) : (
                  <Type className="size-4 text-muted-foreground" />
                )}
                {c.contentType === 'image' ? '이미지' : '텍스트'} 블록
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => handleMove(idx, -1)}
                  disabled={idx === 0}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => handleMove(idx, 1)}
                  disabled={idx === contents.length - 1}
                >
                  <ArrowDown />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => handleDelete(c.id)}>
                  <Trash2 />
                </Button>
              </div>
            </div>

            {c.contentType === 'text' ? (
              <Editor
                key={c.id}
                initialDoc={c.data ?? undefined}
                editable
                onChange={(doc) => handleTextChange(c.id, doc)}
              />
            ) : (
              <ImageBlock
                imagePath={c.imagePath}
                onSelect={(file) => handleImageSelect(c.id, file)}
              />
            )}
          </div>
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            <Plus /> 블록 추가
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => handleAdd('text')}>
            <Type /> 텍스트 블록
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAdd('image')}>
            <ImageIcon /> 이미지 블록
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

function ImageBlock({
  imagePath,
  onSelect,
}: {
  imagePath: string | null
  onSelect: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2">
      {imagePath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={getPostingAssetPublicUrl(imagePath)}
          alt="블록 이미지"
          className="max-h-64 w-full rounded-md border object-contain"
        />
      ) : (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          이미지가 없습니다
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onSelect(file)
          e.target.value = ''
        }}
      />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
        <Upload /> {imagePath ? '이미지 교체' : '이미지 업로드'}
      </Button>
    </div>
  )
}
