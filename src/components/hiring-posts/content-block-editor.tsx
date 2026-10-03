'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
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
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import type { WizardContentData, WizardPositionData, WizardPosition } from './build-types'
import type { ButtonData, BlockLink } from '@/lib/validations/hiring-posts'
import type { ExcalidrawScene } from './excalidraw-canvas'
import { CONTENT_TYPE_META, type ContentType } from './block-editors'
import { BlockEditOverlay } from './block-edit-overlay'
import { ContentBlockPreview } from './posting-preview'
import type { SaveHandle } from './use-queued-save'
import { createTextSaveQueue } from './text-save-queue'

type TemplateItem = {
  id: string
  name: string
  updatedAt: string
  isSample: boolean
  _count: { contents: number }
}

type AppliedTemplate = {
  id: string | null
  name: string
  at: string | null
}

export type ContentBlockEditorHandle = { flush: () => Promise<void> }

type Props = {
  ref?: Ref<ContentBlockEditorHandle>
  postingId: string
  contents: WizardContentData[]
  positions: WizardPositionData[]
  spacePositions: WizardPosition[]
  onPositionsChange: (positions: WizardPositionData[]) => void
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
  ref,
  postingId,
  contents,
  positions,
  spacePositions,
  onPositionsChange,
  appliedTemplate,
  onChange,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const mutationRef = useRef<Promise<void> | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [closingOverlay, setClosingOverlay] = useState(false)
  const overlayRef = useRef<SaveHandle>(null)
  const closingRef = useRef(false)
  const mediaSavesRef = useRef(new Set<Promise<void>>())
  const mediaErrorsRef = useRef(new Map<string, string>())
  const textQueueRef = useRef<ReturnType<typeof createTextSaveQueue> | null>(null)
  if (!textQueueRef.current) {
    textQueueRef.current = createTextSaveQueue(
      (id, data) => patchContent(id, { data }),
      () => toast.error('본문 저장에 실패했습니다. 편집 완료를 눌러 다시 저장하세요.')
    )
  }
  const textQueue = textQueueRef.current
  useImperativeHandle(ref, () => ({ flush: flushContentSaves }))

  function runMutation(action: () => Promise<void>): Promise<void> {
    if (mutationRef.current)
      return Promise.reject(new Error('다른 저장이 진행 중입니다. 완료 후 다시 시도하세요.'))
    setBusy(true)
    const request = Promise.resolve()
      .then(action)
      .finally(() => {
        mutationRef.current = null
        setBusy(false)
      })
    mutationRef.current = request
    return request
  }

  async function flushContentSaves() {
    if (mutationRef.current) await mutationRef.current
    if (editingTitleId && !titleHandledRef.current) await commitTitle(editingTitleId)
    await flushEdits()
  }

  async function flushEdits() {
    if (editingTitleId && !titleHandledRef.current)
      throw new Error('카드 제목을 저장한 뒤 다시 시도하세요.')
    const results = await Promise.allSettled([
      overlayRef.current?.flush(),
      textQueue.flush(),
      ...mediaSavesRef.current,
    ])
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    if (mediaErrorsRef.current.size) throw new Error([...mediaErrorsRef.current.values()][0])
  }

  function saveMedia(contentId: string, action: () => Promise<void>, retryMessage: string) {
    const request = action()
      .then(() => {
        mediaErrorsRef.current.delete(contentId)
      })
      .catch((error: unknown) => {
        mediaErrorsRef.current.set(contentId, retryMessage)
        throw error
      })
      .finally(() => {
        mediaSavesRef.current.delete(request)
      })
    mediaSavesRef.current.add(request)
    return request
  }
  useEffect(() => () => textQueue.dispose(), [textQueue])
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
  // 불러오기 모드: append(기본, 하단 추가) / replace(전체 교체)
  const [applyMode, setApplyMode] = useState<'append' | 'replace'>('append')
  // 선택 템플릿 미리보기(블록 목록) — GET /templates/[id]. 반복 선택 대비 캐시 + 최신요청만 반영.
  const [previewContents, setPreviewContents] = useState<WizardContentData[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewCache = useRef<Map<string, WizardContentData[]>>(new Map())
  const previewReqRef = useRef(0)
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
    try {
      await runMutation(async () => {
        await flushEdits()
        const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType }),
        })
        if (!res.ok) throw new Error('블록 추가에 실패했습니다')
        const { content } = await res.json()
        onChange([...contentsRef.current, content])
        router.refresh()
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '블록 추가에 실패했습니다')
    }
  }

  async function handleDelete(contentId: string) {
    if (!confirm('이 블록을 삭제할까요?')) return
    try {
      await runMutation(async () => {
        await flushEdits()
        const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents/${contentId}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error('삭제에 실패했습니다')
        textQueue.cancel(contentId)
        mediaErrorsRef.current.delete(contentId)
        onChange(contentsRef.current.filter((c) => c.id !== contentId))
        toast.success('블록을 삭제했습니다')
        router.refresh()
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  // 전체 순서를 서버 트랜잭션으로 저장한 뒤 화면에 반영한다.
  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= contents.length) return
    try {
      await runMutation(async () => {
        await flushEdits()
        const next = [...contentsRef.current]
        ;[next[index], next[target]] = [next[target], next[index]]
        const res = await fetch(`/api/hiring-posts/postings/${postingId}/contents`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentIds: next.map((c) => c.id) }),
        })
        if (!res.ok) {
          const error = await res.json().catch(() => ({}))
          throw new Error(error.message ?? '순서 변경 저장에 실패했습니다')
        }
        onChange(next.map((c, sortOrder) => ({ ...c, sortOrder })))
        router.refresh()
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '순서 변경 저장에 실패했습니다')
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
    const prev = contentsRef.current.find((c) => c.id === contentId)?.title ?? null
    const title = titleDraft.trim() || null
    if (title === prev) {
      setEditingTitleId(null)
      return
    }
    try {
      await runMutation(async () => {
        await patchContent(contentId, { title })
        onChange(contentsRef.current.map((c) => (c.id === contentId ? { ...c, title } : c)))
        setEditingTitleId(null)
      })
    } catch (error) {
      titleHandledRef.current = false
      throw error
    }
  }
  function saveTitle(contentId: string) {
    void commitTitle(contentId).catch(() =>
      toast.error('카드 제목 저장에 실패했습니다. 입력은 유지됩니다. 다시 저장하세요.')
    )
  }

  // 텍스트 편집 → 로컬 즉시 반영 + debounce(700ms) PATCH
  function handleTextChange(contentId: string, doc: unknown) {
    onChange(contentsRef.current.map((c) => (c.id === contentId ? { ...c, data: doc } : c)))
    textQueue.schedule(contentId, doc)
  }

  function handleImageSelect(contentId: string, file: File) {
    return saveMedia(
      contentId,
      async () => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다'))
          reader.readAsDataURL(file)
        })
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
      },
      '이미지 업로드가 완료되지 않았습니다. 이미지 다시 업로드를 눌러 재시도하세요.'
    )
  }

  function handleButtonSave(contentId: string, data: ButtonData) {
    onChange(contents.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
  }

  // 이미지 블록 링크 저장 — data 는 링크만(이미지 자체는 imagePath). imageBase64 를 안 보내므로
  // 서버는 imagePath 를 건드리지 않는다(필드 독립).
  function handleImageLinkSave(contentId: string, link: BlockLink) {
    const data = { link }
    onChange(contentsRef.current.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
  }

  // 디자인 블록 링크 저장 — scene JSON 최상위에 link 를 병합해 캔버스 내용을 보존한다.
  function handleDesignLinkSave(contentId: string, link: BlockLink) {
    const current = contentsRef.current.find((c) => c.id === contentId)
    const scene =
      current?.data && typeof current.data === 'object'
        ? (current.data as Record<string, unknown>)
        : {}
    const data = { ...scene, link }
    onChange(contentsRef.current.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
  }

  function handleDesignSave(contentId: string, scene: ExcalidrawScene, imageBase64: string) {
    return saveMedia(
      contentId,
      async () => {
        // Vercel serverless 함수의 요청 바디 한도(~4.5MB) 아래에서 사전 차단해 친절한 안내를 제공한다.
        // scene(붙여넣은 이미지 dataURL 포함) + PNG 를 합산, JSON 오버헤드 여유로 4MB 로 보수적 설정.
        // 캔버스 저장은 새 scene 을 만들어(link 미포함) 넘기므로, 기존에 설정된 링크를 병합 보존한다.
        const existingLink = (
          contentsRef.current.find((c) => c.id === contentId)?.data as
            | { link?: BlockLink }
            | null
            | undefined
        )?.link
        const nextScene: ExcalidrawScene = existingLink ? { ...scene, link: existingLink } : scene
        const payloadChars = JSON.stringify(nextScene).length + imageBase64.length
        if (payloadChars > 4 * 1024 * 1024) {
          throw new Error('디자인이 너무 큽니다. 캔버스에 넣은 이미지 수·크기를 줄여주세요')
        }
        const updated = await patchContent(contentId, { data: nextScene, imageBase64 })
        onChange(
          contentsRef.current.map((c) =>
            c.id === contentId ? { ...c, data: nextScene, imagePath: updated.imagePath } : c
          )
        )
        toast.success('디자인을 저장했습니다')
      },
      '디자인 저장이 완료되지 않았습니다. 카드저장을 눌러 재시도하세요.'
    )
  }

  // 저장이 끝나기 전에는 편집기를 유지해 완료·템플릿 저장으로 넘어가지 않는다.
  async function handleOverlayClose() {
    if (closingRef.current) return
    closingRef.current = true
    setClosingOverlay(true)
    try {
      await flushContentSaves()
      setEditingBlockId(null)
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '저장에 실패했습니다. 입력은 유지됩니다. 다시 시도하세요.'
      )
    } finally {
      closingRef.current = false
      setClosingOverlay(false)
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
    if (mutationRef.current) return
    const name = templateName.trim()
    if (!name) {
      toast.error('템플릿 이름을 입력하세요')
      return
    }
    const overwriteId = saveMode === 'overwrite' ? (templateInfo?.id ?? null) : null
    setSavingTemplate(true)
    try {
      await runMutation(async () => {
        await flushEdits()
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
      })
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
    setApplyMode('append')
    setPreviewContents(null)
    setPreviewError(null)
    setPreviewLoading(false)
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

  // 템플릿 선택 → 미리보기 블록 로드(캐시 우선). 빠른 전환 시 마지막 요청만 반영.
  async function selectTemplate(id: string) {
    setSelectedTemplateId(id)
    setPreviewError(null)
    const cached = previewCache.current.get(id)
    if (cached) {
      setPreviewContents(cached)
      setPreviewLoading(false)
      return
    }
    const reqId = ++previewReqRef.current
    setPreviewContents(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/hiring-posts/templates/${id}`)
      if (!res.ok) throw new Error('미리보기를 불러오지 못했습니다')
      const { contents } = await res.json()
      previewCache.current.set(id, contents)
      if (previewReqRef.current === reqId) setPreviewContents(contents)
    } catch (err) {
      if (previewReqRef.current === reqId) {
        setPreviewError(err instanceof Error ? err.message : '미리보기를 불러오지 못했습니다')
      }
    } finally {
      if (previewReqRef.current === reqId) setPreviewLoading(false)
    }
  }

  // 템플릿 적용 — 기존 블록 전체 교체
  async function handleApplyTemplate() {
    if (!selectedTemplateId || mutationRef.current) return
    setApplyingTemplate(true)
    try {
      await runMutation(async () => {
        await flushEdits()
        const res = await fetch(`/api/hiring-posts/postings/${postingId}/apply-template`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ templateId: selectedTemplateId, mode: applyMode }),
        })
        if (!res.ok) throw new Error('템플릿 적용에 실패했습니다')
        const { contents: next } = await res.json()
        for (const content of contentsRef.current) textQueue.cancel(content.id)
        mediaErrorsRef.current.clear()
        setEditingBlockId(null)
        setEditingTitleId(null)
        onChange(next)
        const applied = templates?.find((t) => t.id === selectedTemplateId)
        setTemplateInfo(
          applied ? { id: applied.id, name: applied.name, at: new Date().toISOString() } : null
        )
        setLoadDialogOpen(false)
        toast.success(
          applyMode === 'append' ? '템플릿 블록을 추가했습니다' : '템플릿을 적용했습니다'
        )
        router.refresh()
      })
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
    <div inert={busy} className="space-y-4">
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
                      onBlur={() => saveTitle(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          saveTitle(c.id)
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
                    aria-label="카드 위로 이동"
                    onClick={() => handleMove(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="카드 아래로 이동"
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
        ref={overlayRef}
        open={editingBlockId !== null}
        content={editingBlock}
        postingId={postingId}
        positions={positions}
        spacePositions={spacePositions}
        onPositionsChange={onPositionsChange}
        onClose={handleOverlayClose}
        saving={closingOverlay}
        onTextChange={handleTextChange}
        onButtonSave={handleButtonSave}
        onImageSelect={handleImageSelect}
        onImageLinkSave={handleImageLinkSave}
        onDesignSave={handleDesignSave}
        onDesignLinkSave={handleDesignLinkSave}
      />

      {/* 템플릿으로 저장 다이얼로그 */}
      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          if (!open && !savingTemplate) {
            setSaveDialogOpen(false)
            setTemplateName('')
          }
        }}
      >
        <DialogContent inert={savingTemplate} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>템플릿으로 저장</DialogTitle>
            <DialogDescription>
              현재 공고 내용을 템플릿으로 저장해 다음 공고에 재사용하세요.
            </DialogDescription>
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
          if (!open && !applyingTemplate) setLoadDialogOpen(false)
        }}
      >
        <DialogContent inert={applyingTemplate} className="flex max-h-[85vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>템플릿 불러오기</DialogTitle>
            <DialogDescription>
              현재 공고에 템플릿을 추가하거나 기존 카드를 교체합니다.
            </DialogDescription>
          </DialogHeader>
          {/* 좌: 템플릿 목록 / 우: 선택 템플릿 미리보기. 모바일(sm 미만)은 세로 스택. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
            <div className="flex min-h-0 flex-col sm:w-2/5">
              {templates === null ? (
                <p className="py-4 text-center text-sm text-muted-foreground">불러오는 중…</p>
              ) : templates.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  저장된 템플릿이 없습니다. 템플릿으로 저장 버튼으로 먼저 만들어 보세요.
                </p>
              ) : (
                <div className="max-h-56 min-h-0 flex-1 space-y-1 overflow-y-auto sm:max-h-[60vh]">
                  {templates.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md border px-4 py-2.5 hover:bg-accent/50 has-checked:border-primary"
                    >
                      <input
                        type="radio"
                        name="load-template"
                        checked={selectedTemplateId === t.id}
                        onChange={() => selectTemplate(t.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {t.name}
                          {t.isSample && (
                            <span className="ml-2 text-xs text-muted-foreground">샘플</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          블록 {t._count.contents}개 · {formatTemplateAt(t.updatedAt)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-muted/20 sm:w-3/5">
              {!selectedTemplateId ? (
                <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  템플릿을 선택하면 미리보기가 표시됩니다
                </div>
              ) : previewLoading ? (
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> 미리보기 불러오는 중…
                </div>
              ) : previewError ? (
                <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-destructive">
                  {previewError}
                </div>
              ) : previewContents && previewContents.length > 0 ? (
                <div className="max-h-64 min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:max-h-[60vh]">
                  {previewContents.map((c) => (
                    <ContentBlockPreview key={c.id} content={c} positions={[]} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  이 템플릿에는 표시할 블록이 없습니다
                </div>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="apply-mode"
                  checked={applyMode === 'append'}
                  onChange={() => setApplyMode('append')}
                />
                현재 블록 하단에 추가
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="apply-mode"
                  checked={applyMode === 'replace'}
                  onChange={() => setApplyMode('replace')}
                />
                기존 블록 교체
              </label>
            </div>
            {applyMode === 'replace' && contents.length > 0 && (
              <p className="text-xs text-destructive">
                적용하면 기존 블록 {contents.length}개가 모두 교체됩니다.
              </p>
            )}
          </div>
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
