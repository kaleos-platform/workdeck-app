'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
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
  FolderOpen,
  TriangleAlert,
  Shapes,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Editor } from '@/components/sc/editor/editor'
import { cn } from '@/lib/utils'
import { BUTTON_DEFAULT_COLOR, BUTTON_PRESET_COLORS } from '@/lib/hiring/button-color'
import { AutoSaveIndicator } from './autosave-indicator'
import { getPostingAssetPublicUrl, type WizardContentData } from './build-types'
import { buttonDataSchema, type ButtonData } from '@/lib/validations/hiring-posts'
import type { ExcalidrawScene } from './excalidraw-canvas'

const ExcalidrawCanvas = dynamic(
  () => import('./excalidraw-canvas').then((m) => m.ExcalidrawCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[480px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
        캔버스 불러오는 중…
      </div>
    ),
  }
)

type ContentType = 'text' | 'image' | 'button' | 'positions' | 'design'

type TemplateItem = {
  id: string
  name: string
  updatedAt: string
  _count: { contents: number }
}

type AppliedTemplate = {
  id: string | null
  name: string
  at: string | null
}

type Props = {
  postingId: string
  contents: WizardContentData[]
  positions: { id: string; name: string }[]
  appliedTemplate: AppliedTemplate | null
  onChange: (contents: WizardContentData[]) => void
}

// "2026. 7. 12. 오후 2:11" 형식
function formatTemplateAt(at: string | null): string | null {
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

const CONTENT_TYPE_META: Record<ContentType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: '텍스트' },
  image: { icon: ImageIcon, label: '이미지' },
  button: { icon: MousePointerClick, label: '버튼' },
  positions: { icon: Briefcase, label: '직무 정보' },
  design: { icon: Shapes, label: '디자인' },
}

export function ContentBlockEditor({
  postingId,
  contents,
  positions,
  appliedTemplate,
  onChange,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  // 텍스트 블록별 debounce 타이머 (data 저장)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null)
  const [remountTick, setRemountTick] = useState(0)
  // 템플릿 저장/불러오기 다이얼로그
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [loadDialogOpen, setLoadDialogOpen] = useState(false)
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  // 마지막 저장/적용 템플릿 정보 (서버 스냅샷 + 클라이언트 즉시 갱신)
  const [templateInfo, setTemplateInfo] = useState<AppliedTemplate | null>(appliedTemplate)
  // 저장 모드: 현재 템플릿 덮어쓰기 vs 새 템플릿
  const [saveMode, setSaveMode] = useState<'overwrite' | 'new'>('new')

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

  async function handleDesignSave(contentId: string, scene: unknown, imageBase64: string) {
    // Vercel serverless 함수의 요청 바디 한도(~4.5MB) 아래에서 사전 차단해 친절한 안내를 제공한다.
    // (초과 시 플랫폼이 413/제네릭 실패로 떨어뜨려 원인 불명 토스트만 뜨므로 여기서 먼저 막는다.)
    // scene(붙여넣은 이미지 dataURL 포함) + PNG 를 합산, JSON 오버헤드 여유로 4MB 로 보수적 설정.
    const payloadChars = JSON.stringify(scene).length + imageBase64.length
    if (payloadChars > 4 * 1024 * 1024) {
      toast.error('디자인이 너무 큽니다. 캔버스에 넣은 이미지 수·크기를 줄여주세요')
      return
    }
    try {
      const updated = await patchContent(contentId, { data: scene, imageBase64 })
      onChange(
        contents.map((c) =>
          c.id === contentId ? { ...c, data: scene, imagePath: updated.imagePath } : c
        )
      )
      toast.success('디자인을 저장했습니다')
    } catch {
      toast.error('디자인 저장에 실패했습니다')
    }
  }

  function openSaveDialog() {
    // 현재 템플릿이 있으면 덮어쓰기 기본 + 이름 프리필
    if (templateInfo?.id) {
      setSaveMode('overwrite')
      setTemplateName(templateInfo.name)
    } else {
      setSaveMode('new')
      setTemplateName('')
    }
    setSaveDialogOpen(true)
  }

  async function handleSaveTemplate() {
    const name = templateName.trim()
    if (!name) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    const overwriteId = saveMode === 'overwrite' ? (templateInfo?.id ?? null) : null
    setSavingTemplate(true)
    try {
      const res = await fetch('/api/hiring-posts/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          postingId,
          ...(overwriteId ? { templateId: overwriteId } : {}),
        }),
      })
      if (res.status === 404 && overwriteId) {
        throw new Error('원본 템플릿이 삭제되었습니다 — 새 템플릿으로 저장하세요')
      }
      if (!res.ok) throw new Error('템플릿 저장에 실패했습니다')
      const { template } = await res.json()
      setTemplateInfo({ id: template.id, name, at: new Date().toISOString() })
      setTemplateName('')
      setSaveDialogOpen(false)
      toast.success(
        overwriteId ? '템플릿을 덮어썼습니다' : '현재 상세를 새 템플릿으로 저장했습니다'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 저장에 실패했습니다')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function openLoadDialog() {
    setLoadDialogOpen(true)
    setSelectedTemplateId(null)
    setTemplates(null)
    try {
      const res = await fetch('/api/hiring-posts/templates')
      if (!res.ok) throw new Error('템플릿 목록을 불러오지 못했습니다')
      const { templates } = await res.json()
      setTemplates(templates)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 목록을 불러오지 못했습니다')
      setTemplates([])
    }
  }

  // 템플릿 적용 — 기존 블록 전체 교체
  async function handleApplyTemplate() {
    if (!selectedTemplateId) return
    setApplyingTemplate(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedTemplateId }),
      })
      if (!res.ok) throw new Error('템플릿 적용에 실패했습니다')
      const { contents: next } = await res.json()
      onChange(next)
      const applied = templates?.find((t) => t.id === selectedTemplateId)
      setTemplateInfo(
        applied ? { id: applied.id, name: applied.name, at: new Date().toISOString() } : null
      )
      setRemountTick((t) => t + 1)
      setLoadDialogOpen(false)
      toast.success('템플릿을 적용했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 적용에 실패했습니다')
    } finally {
      setApplyingTemplate(false)
    }
  }

  const focusBlock = focusBlockId ? contents.find((c) => c.id === focusBlockId) : null

  return (
    <div className="space-y-4">
      {/* 템플릿 툴바 — 좌: 현재 템플릿 정보 / 우: 불러오기·저장 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {templateInfo ? (
            <>
              <FolderOpen className="size-3.5 shrink-0" />
              <span
                className="min-w-0 truncate font-medium text-foreground"
                title={templateInfo.name}
              >
                {templateInfo.name}
              </span>
              {formatTemplateAt(templateInfo.at) && (
                <span className="shrink-0">· {formatTemplateAt(templateInfo.at)}</span>
              )}
            </>
          ) : (
            <span>템플릿 미사용</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={openLoadDialog}>
            <FolderOpen /> 템플릿 불러오기
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={openSaveDialog}
            disabled={contents.length === 0}
          >
            <Save /> 템플릿으로 저장
          </Button>
        </div>
      </div>

      {contents.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          공고를 꾸밀 블록이 없습니다. 아래에서 블록을 추가하세요.
        </div>
      )}

      <div className="space-y-4">
        {contents.map((c, idx) => {
          const meta = CONTENT_TYPE_META[c.contentType]
          // 알 수 없는(레거시) contentType — 렌더 크래시 방지, 삭제만 허용
          const isUnsupported = !meta
          const Icon = meta?.icon ?? TriangleAlert
          return (
            <div key={c.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-muted-foreground" />
                  {meta?.label ?? '지원하지 않는'} 블록
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

              {isUnsupported ? (
                <p className="text-xs text-muted-foreground">
                  지원하지 않는 블록입니다. 삭제 후 새 블록을 추가하세요.
                </p>
              ) : c.contentType === 'text' ? (
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
              ) : c.contentType === 'design' ? (
                <DesignBlock
                  key={`${c.id}-${remountTick}`}
                  scene={c.data}
                  onSave={(scene, imageBase64) => handleDesignSave(c.id, scene, imageBase64)}
                />
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
          <DropdownMenuItem onClick={() => handleAdd('design')}>
            <Shapes /> 디자인 블록
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 템플릿으로 저장 다이얼로그 */}
      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setSaveDialogOpen(false)
            setTemplateName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>템플릿으로 저장</DialogTitle>
          </DialogHeader>
          {templateInfo?.id && (
            <div className="space-y-1.5">
              <Label>저장 방식</Label>
              <div className="space-y-1">
                <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-primary">
                  <input
                    type="radio"
                    name="tpl-save-mode"
                    checked={saveMode === 'overwrite'}
                    onChange={() => {
                      setSaveMode('overwrite')
                      setTemplateName(templateInfo.name)
                    }}
                  />
                  <span className="min-w-0 truncate">
                    기존 템플릿 덮어쓰기: <span className="font-medium">{templateInfo.name}</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-primary">
                  <input
                    type="radio"
                    name="tpl-save-mode"
                    checked={saveMode === 'new'}
                    onChange={() => {
                      setSaveMode('new')
                      setTemplateName('')
                    }}
                  />
                  새 템플릿으로 저장
                </label>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">템플릿 이름</Label>
            <Input
              id="tpl-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="예: 매장 알바 기본 상세"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              {saveMode === 'overwrite' && templateInfo?.id
                ? `현재 블록 ${contents.length}개로 기존 템플릿 내용을 교체합니다.`
                : `현재 블록 ${contents.length}개를 새 템플릿으로 저장합니다.`}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSaveDialogOpen(false)
                setTemplateName('')
              }}
              disabled={savingTemplate}
            >
              취소
            </Button>
            <Button size="sm" onClick={handleSaveTemplate} disabled={savingTemplate}>
              <Save /> 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 템플릿 불러오기 다이얼로그 */}
      <Dialog
        open={loadDialogOpen}
        onOpenChange={(open) => {
          if (!open) setLoadDialogOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>템플릿 불러오기</DialogTitle>
          </DialogHeader>
          {templates === null ? (
            <p className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : templates.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              저장된 템플릿이 없습니다. 템플릿으로 저장 버튼으로 먼저 만들어 보세요.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {templates.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border px-4 py-2.5 hover:bg-accent/50 has-checked:border-primary"
                >
                  <input
                    type="radio"
                    name="load-template"
                    checked={selectedTemplateId === t.id}
                    onChange={() => setSelectedTemplateId(t.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      블록 {t._count.contents}개 · {formatTemplateAt(t.updatedAt)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
          {selectedTemplateId && contents.length > 0 && (
            <p className="text-xs text-destructive">
              적용하면 기존 블록 {contents.length}개가 모두 교체됩니다.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadDialogOpen(false)}
              disabled={applyingTemplate}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleApplyTemplate}
              disabled={!selectedTemplateId || applyingTemplate}
            >
              <FolderOpen /> 적용
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  const [color, setColor] = useState(data?.color ?? BUTTON_DEFAULT_COLOR)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const uid = useId()

  type ButtonDraft = { title: string; linkType: 'form' | 'url'; url: string; color: string }

  function attemptSave(next: ButtonDraft) {
    const result = buttonDataSchema.safeParse({
      title: next.title,
      linkType: next.linkType,
      url: next.url || undefined,
      color: next.color,
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

  function debouncedSave(next: ButtonDraft) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => attemptSave(next), 600)
  }

  useEffect(() => {
    return () => clearTimeout(timer.current)
  }, [])

  function handleTitleChange(value: string) {
    setTitle(value)
    debouncedSave({ title: value, linkType, url, color })
  }
  function handleTitleBlur() {
    clearTimeout(timer.current)
    attemptSave({ title, linkType, url, color })
  }
  function handleUrlChange(value: string) {
    setUrl(value)
    debouncedSave({ title, linkType, url: value, color })
  }
  function handleUrlBlur() {
    clearTimeout(timer.current)
    attemptSave({ title, linkType, url, color })
  }
  function handleLinkTypeChange(value: 'form' | 'url') {
    setLinkType(value)
    clearTimeout(timer.current)
    // url 전환 직후 빈 URL로 즉시 검증하면 에러가 뜨므로 입력을 기다린다
    if (value === 'url' && !url.trim()) {
      setError(null)
      return
    }
    attemptSave({ title, linkType: value, url, color })
  }
  function handleColorChange(value: string, immediate: boolean) {
    setColor(value)
    const next = { title, linkType, url, color: value }
    if (immediate) {
      clearTimeout(timer.current)
      attemptSave(next)
    } else {
      debouncedSave(next)
    }
  }

  return (
    <div className="space-y-3">
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
      <div className="space-y-1.5">
        <Label>버튼 색상</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {BUTTON_PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`버튼 색상 ${c}`}
              className={cn(
                'size-7 cursor-pointer rounded-full border transition',
                color.toLowerCase() === c.toLowerCase()
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                  : 'hover:scale-110'
              )}
              style={{ backgroundColor: c }}
              onClick={() => handleColorChange(c, true)}
            />
          ))}
          <label
            className="relative ml-1 flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]"
            aria-label="커스텀 색상"
            title="커스텀 색상"
          >
            <input
              type="color"
              value={color}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              onChange={(e) => handleColorChange(e.target.value, false)}
              onBlur={() => handleColorChange(color, true)}
            />
          </label>
        </div>
      </div>
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

function DesignBlock({
  scene,
  onSave,
}: {
  scene: unknown
  onSave: (scene: ExcalidrawScene, imageBase64: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  // 저장된 scene → excalidraw initialData 복원 (files 포함, 재편집 보장)
  const initialData =
    scene && typeof scene === 'object' && 'elements' in (scene as Record<string, unknown>)
      ? {
          elements: (scene as { elements?: unknown[] }).elements as never,
          appState: (scene as { appState?: object }).appState as never,
          files: (scene as { files?: unknown }).files as never,
        }
      : null
  return (
    <ExcalidrawCanvas
      initialData={initialData}
      saving={saving}
      onSave={async (s, img) => {
        setSaving(true)
        try {
          await onSave(s, img)
        } finally {
          setSaving(false)
        }
      }}
    />
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
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          <Upload /> {imagePath ? '이미지 교체' : '이미지 업로드'}
        </Button>
        <p className="text-xs text-muted-foreground">
          권장: 가로 1280px 이상(표시 폭 640px · 선명도 2x) · JPG/PNG · 10MB 이하. 세로 길이는
          자유입니다.
        </p>
      </div>
    </div>
  )
}
