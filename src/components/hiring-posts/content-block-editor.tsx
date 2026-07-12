'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Type,
  ImageIcon,
  Upload,
  Save,
  MousePointerClick,
  Briefcase,
  Maximize2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Editor } from '@/components/sc/editor/editor'
import { AutoSaveIndicator } from './autosave-indicator'
import { getPostingAssetPublicUrl, type WizardContentData } from './build-types'
import { buttonDataSchema, type ButtonData } from '@/lib/validations/hiring-posts'

type ContentType = 'text' | 'image' | 'button' | 'positions'

type Props = {
  postingId: string
  contents: WizardContentData[]
  positions: { id: string; name: string }[]
  onChange: (contents: WizardContentData[]) => void
}

const CONTENT_TYPE_META: Record<ContentType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: '텍스트' },
  image: { icon: ImageIcon, label: '이미지' },
  button: { icon: MousePointerClick, label: '버튼' },
  positions: { icon: Briefcase, label: '직무 정보' },
}

export function ContentBlockEditor({ postingId, contents, positions, onChange }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  // 텍스트 블록별 debounce 타이머 (data 저장)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null)
  const [remountTick, setRemountTick] = useState(0)

  const hasPositionsBlock = contents.some((c) => c.contentType === 'positions')

  async function patchContent(contentId: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents/${contentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('저장에 실패했습니다')
    return (await res.json()).content as WizardContentData
  }

  async function handleAdd(contentType: ContentType) {
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

  function handleButtonSave(contentId: string, data: ButtonData) {
    onChange(contents.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
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

  const focusBlock = focusBlockId ? contents.find((c) => c.id === focusBlockId) : null

  return (
    <div className="space-y-4">
      {contents.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          공고를 꾸밀 블록이 없습니다. 아래에서 블록을 추가하세요.
        </div>
      )}

      <div className="space-y-4">
        {contents.map((c, idx) => {
          const meta = CONTENT_TYPE_META[c.contentType]
          const Icon = meta.icon
          return (
            <div key={c.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-muted-foreground" />
                  {meta.label} 블록
                </div>
                <div className="flex items-center gap-1">
                  {c.contentType === 'text' && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="크게 작성"
                      onClick={() => setFocusBlockId(c.id)}
                    >
                      <Maximize2 />
                    </Button>
                  )}
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
                  key={`${c.id}-${remountTick}`}
                  initialDoc={c.data ?? undefined}
                  editable
                  onChange={(doc) => handleTextChange(c.id, doc)}
                />
              ) : c.contentType === 'button' ? (
                <ButtonBlock
                  data={c.data as ButtonData | null}
                  onSave={(data) => handleButtonSave(c.id, data)}
                />
              ) : c.contentType === 'positions' ? (
                <PositionsBlock positions={positions} />
              ) : (
                <ImageBlock
                  imagePath={c.imagePath}
                  onSelect={(file) => handleImageSelect(c.id, file)}
                />
              )}
            </div>
          )
        })}
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
          <DropdownMenuItem onClick={() => handleAdd('button')}>
            <MousePointerClick /> 버튼 블록
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleAdd('positions')} disabled={hasPositionsBlock}>
            <Briefcase /> 직무 정보 블록
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

      <Dialog
        open={focusBlockId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFocusBlockId(null)
            setRemountTick((t) => t + 1)
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>본문 작성</DialogTitle>
          </DialogHeader>
          {focusBlock && (
            <Editor
              initialDoc={focusBlock.data ?? undefined}
              editable
              variant="full"
              onChange={(doc) => handleTextChange(focusBlock.id, doc)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ButtonBlock({
  data,
  onSave,
}: {
  data: ButtonData | null
  onSave: (data: ButtonData) => Promise<unknown>
}) {
  const [title, setTitle] = useState(data?.title ?? '지원하기')
  const [linkType, setLinkType] = useState<'form' | 'url'>(data?.linkType ?? 'form')
  const [url, setUrl] = useState(data?.url ?? '')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const uid = useId()

  function attemptSave(next: { title: string; linkType: 'form' | 'url'; url: string }) {
    const result = buttonDataSchema.safeParse({
      title: next.title,
      linkType: next.linkType,
      url: next.url || undefined,
    })
    if (!result.success) {
      const first = result.error.issues[0]
      setError(first?.message ?? '입력 값을 확인하세요')
      return
    }
    setError(null)
    setStatus('saving')
    onSave(result.data)
      .then(() => setStatus('saved'))
      .catch(() => {
        toast.error('버튼 저장에 실패했습니다')
        setStatus('idle')
      })
  }

  function debouncedSave(next: { title: string; linkType: 'form' | 'url'; url: string }) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => attemptSave(next), 600)
  }

  useEffect(() => {
    return () => clearTimeout(timer.current)
  }, [])

  function handleTitleChange(value: string) {
    setTitle(value)
    debouncedSave({ title: value, linkType, url })
  }
  function handleTitleBlur() {
    clearTimeout(timer.current)
    attemptSave({ title, linkType, url })
  }
  function handleUrlChange(value: string) {
    setUrl(value)
    debouncedSave({ title, linkType, url: value })
  }
  function handleUrlBlur() {
    clearTimeout(timer.current)
    attemptSave({ title, linkType, url })
  }
  function handleLinkTypeChange(value: 'form' | 'url') {
    setLinkType(value)
    clearTimeout(timer.current)
    // url 전환 직후 빈 URL로 즉시 검증하면 에러가 뜨므로 입력을 기다린다
    if (value === 'url' && !url.trim()) {
      setError(null)
      return
    }
    attemptSave({ title, linkType: value, url })
  }

  return (
    <div className="space-y-3">
      {/* 실제 버튼 UI 미리보기 */}
      <div className="pointer-events-none flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow">
        {title || '버튼 제목'}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${uid}-btn-title`}>버튼 제목</Label>
          <AutoSaveIndicator status={status} />
        </div>
        <Input
          id={`${uid}-btn-title`}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="예: 지금 바로 지원하기"
          maxLength={50}
        />
      </div>
      <div className="space-y-1.5">
        <Label>링크 유형</Label>
        <div className="flex gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={`${uid}-btn-linktype`}
              value="form"
              checked={linkType === 'form'}
              onChange={() => handleLinkTypeChange('form')}
            />
            지원서 폼 연결
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={`${uid}-btn-linktype`}
              value="url"
              checked={linkType === 'url'}
              onChange={() => handleLinkTypeChange('url')}
            />
            URL 직접 입력
          </label>
        </div>
      </div>
      {linkType === 'url' && (
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-btn-url`}>URL</Label>
          <Input
            id={`${uid}-btn-url`}
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://example.com"
          />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

function PositionsBlock({ positions }: { positions: { id: string; name: string }[] }) {
  return (
    <div className="space-y-2">
      {positions.length > 0 ? (
        <ul className="space-y-1">
          {positions.map((p) => (
            <li key={p.id} className="rounded-md border px-3 py-2 text-sm">
              {p.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          등록된 직무가 없습니다
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        1단계 기본 정보에서 직무를 편집하세요. 공개 페이지에는 이 위치에 근무조건 카드가 표시됩니다.
      </p>
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
