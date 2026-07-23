'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Type,
  ImageIcon,
  Save,
  MousePointerClick,
  Briefcase,
  FolderOpen,
  TriangleAlert,
  Shapes,
  Pencil,
  SquarePen,
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
import type { WizardContentData, WizardPositionData } from './build-types'
import type { ButtonData } from '@/lib/validations/hiring-posts'
import type { ExcalidrawScene } from './excalidraw-canvas'
import { CONTENT_TYPE_META, type ContentType } from './block-editors'
import { BlockEditOverlay } from './block-edit-overlay'
import { ContentBlockPreview } from './posting-preview'

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
  positions: WizardPositionData[]
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

// Tiptap doc 에 실제 내용(텍스트/이미지 등)이 있는지 — 빈 문단만 있는 doc 은 false.
// (에디터를 열었다 닫으면 onChange 가 빈 문단 doc 를 내보내 c.data 가 truthy 가 되므로 값만으로 판단 불가.)
function textDocHasContent(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false
    const n = node as { type?: string; text?: string; content?: unknown[] }
    if (typeof n.text === 'string' && n.text.trim() !== '') return true
    // 텍스트가 아닌 leaf 노드(이미지·구분선 등)도 내용으로 간주.
    if (n.type && n.type !== 'doc' && n.type !== 'paragraph' && !n.content) return true
    return Array.isArray(n.content) && n.content.some(walk)
  }
  return walk(data)
}

// 리스트 썸네일에 표시할 실제 내용이 있는지 — 없으면 "편집을 눌러 작성" 안내.
function blockHasContent(c: WizardContentData): boolean {
  switch (c.contentType) {
    case 'image':
    case 'design':
      return Boolean(c.imagePath)
    case 'button':
      return Boolean((c.data as { title?: string } | null)?.title)
    case 'positions':
      return true
    case 'text':
      return textDocHasContent(c.data)
    default:
      return false
  }
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
  // 풀스크린 편집 오버레이 대상 블록
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  // 제목 인라인 편집
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  // 한 편집 세션에서 커밋/취소를 1회만 — Enter·blur·Escape 가 겹쳐 중복 PATCH·취소 무효화되는 것 방지.
  const titleHandledRef = useRef(false)
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
  // 비동기 저장 완료 후 최신 contents 를 참조하기 위한 ref(await 동안 부모 state 가 갱신될 수 있음)
  const contentsRef = useRef(contents)
  contentsRef.current = contents

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

  // 제목 인라인 편집 커밋 — 빈 값은 null(리스트에서 "카드 N" 폴백)
  function startEditTitle(c: WizardContentData) {
    titleHandledRef.current = false
    setEditingTitleId(c.id)
    setTitleDraft(c.title ?? '')
  }
  // Escape 취소 — blur 재커밋을 막기 위해 handled 플래그를 세운 뒤 닫는다.
  function cancelTitle() {
    titleHandledRef.current = true
    setEditingTitleId(null)
  }
  async function commitTitle(contentId: string) {
    if (titleHandledRef.current) return
    titleHandledRef.current = true
    const prev = contents.find((c) => c.id === contentId)?.title ?? null
    const raw = titleDraft.trim()
    const title = raw === '' ? null : raw
    setEditingTitleId(null)
    if (title === prev) return
    onChange(contents.map((c) => (c.id === contentId ? { ...c, title } : c)))
    try {
      await patchContent(contentId, { title })
    } catch {
      toast.error('제목 저장에 실패했습니다')
      // 저장 실패 → 낙관적 갱신 롤백(진행 중 다른 저장 보존 위해 최신 ref 기준).
      onChange(contentsRef.current.map((c) => (c.id === contentId ? { ...c, title: prev } : c)))
    }
  }

  // 텍스트 편집 → 로컬 즉시 반영 + debounce(700ms) PATCH
  function handleTextChange(contentId: string, doc: unknown) {
    onChange(contents.map((c) => (c.id === contentId ? { ...c, data: doc } : c)))
    clearTimeout(timers.current[contentId])
    timers.current[contentId] = setTimeout(() => {
      patchContent(contentId, { data: doc })
        .catch(() => toast.error('본문 저장에 실패했습니다'))
        .finally(() => {
          delete timers.current[contentId]
        })
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
        contentsRef.current.map((c) =>
          c.id === contentId ? { ...c, imagePath: updated.imagePath } : c
        )
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

  async function handleDesignSave(contentId: string, scene: ExcalidrawScene, imageBase64: string) {
    // Vercel serverless 함수의 요청 바디 한도(~4.5MB) 아래에서 사전 차단해 친절한 안내를 제공한다.
    // scene(붙여넣은 이미지 dataURL 포함) + PNG 를 합산, JSON 오버헤드 여유로 4MB 로 보수적 설정.
    const payloadChars = JSON.stringify(scene).length + imageBase64.length
    if (payloadChars > 4 * 1024 * 1024) {
      toast.error('디자인이 너무 큽니다. 캔버스에 넣은 이미지 수·크기를 줄여주세요')
      return
    }
    try {
      const updated = await patchContent(contentId, { data: scene, imageBase64 })
      onChange(
        contentsRef.current.map((c) =>
          c.id === contentId ? { ...c, data: scene, imagePath: updated.imagePath } : c
        )
      )
      toast.success('디자인을 저장했습니다')
    } catch {
      toast.error('디자인 저장에 실패했습니다')
    }
  }

  // 오버레이 닫기 — 열린 블록의 pending 텍스트 저장을 flush.
  function handleOverlayClose() {
    const id = editingBlockId
    if (id) {
      const t = timers.current[id]
      if (t) {
        clearTimeout(t)
        delete timers.current[id]
        const c = contents.find((x) => x.id === id)
        if (c && c.contentType === 'text') {
          patchContent(id, { data: c.data }).catch(() => toast.error('본문 저장에 실패했습니다'))
        }
      }
    }
    setEditingBlockId(null)
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
      setLoadDialogOpen(false)
      toast.success('템플릿을 적용했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '템플릿 적용에 실패했습니다')
    } finally {
      setApplyingTemplate(false)
    }
  }

  const editingBlock = editingBlockId
    ? (contents.find((c) => c.id === editingBlockId) ?? null)
    : null

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

      <div className="space-y-3">
        {contents.map((c, idx) => {
          const meta = CONTENT_TYPE_META[c.contentType as ContentType]
          // 알 수 없는(레거시) contentType — 렌더 크래시 방지, 삭제만 허용
          const isUnsupported = !meta
          const Icon = meta?.icon ?? TriangleAlert
          return (
            <div key={c.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  {editingTitleId === c.id ? (
                    <Input
                      autoFocus
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => commitTitle(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitTitle(c.id)
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelTitle()
                        }
                      }}
                      maxLength={100}
                      className="h-7 w-48"
                    />
                  ) : (
                    <>
                      <span className="truncate">{c.title?.trim() || `카드 ${idx + 1}`}</span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="제목 편집"
                        onClick={() => startEditTitle(c)}
                      >
                        <Pencil />
                      </Button>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {meta?.label ?? '지원하지 않는'}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!isUnsupported && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-1"
                      onClick={() => setEditingBlockId(c.id)}
                    >
                      <SquarePen /> 편집
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
              ) : blockHasContent(c) ? (
                <div className="pointer-events-none max-h-32 overflow-hidden rounded-md border bg-muted/20 p-3">
                  <ContentBlockPreview content={c} positions={positions} />
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  아직 내용이 없습니다. 편집을 눌러 작성하세요.
                </div>
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

      {/* 풀스크린 편집 오버레이 */}
      <BlockEditOverlay
        open={editingBlockId !== null}
        content={editingBlock}
        positions={positions}
        onClose={handleOverlayClose}
        onTextChange={handleTextChange}
        onButtonSave={handleButtonSave}
        onImageSelect={handleImageSelect}
        onDesignSave={handleDesignSave}
      />

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
    </div>
  )
}
