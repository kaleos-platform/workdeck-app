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
  MousePointerClick,
  TriangleAlert,
  Shapes,
  Pencil,
  SquarePen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { WizardContentData } from '@/components/hiring-posts/build-types'
import type { ButtonData, BlockLink } from '@/lib/validations/hiring-posts'
import type { ExcalidrawScene } from '@/components/hiring-posts/excalidraw-canvas'
import { CONTENT_TYPE_META, type ContentType } from '@/components/hiring-posts/block-editors'
import { BlockEditOverlay } from '@/components/hiring-posts/block-edit-overlay'
import { ContentBlockPreview } from '@/components/hiring-posts/posting-preview'
import { PreviewFrame } from '@/components/hiring-posts/preview-frame'
import { Card, CardContent } from '@/components/ui/card'

// 어드민 샘플 템플릿 블록에서 허용하는 타입 — 'positions'(직무 정보)는 실제 공고
// (HiringPostingPosition)에 종속된 블록이라 postingId 없는 샘플 템플릿에는 추가할 수 없다.
// 단, 과거 opening deck 이관 샘플에는 'positions' 블록이 이미 존재할 수 있어(레거시), 표시는
// 하되 편집 불가(삭제만 허용)로 처리한다 — content-block-editor.tsx 의 isUnsupported 패턴과 동일.
const ADDABLE_TYPES: { type: ContentType; icon: typeof Type; label: string }[] = [
  { type: 'text', icon: Type, label: '텍스트 블록' },
  { type: 'image', icon: ImageIcon, label: '이미지 블록' },
  { type: 'button', icon: MousePointerClick, label: '버튼 블록' },
  { type: 'design', icon: Shapes, label: '디자인 블록' },
]

function textDocHasContent(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false
    const n = node as { type?: string; text?: string; content?: unknown[] }
    if (typeof n.text === 'string' && n.text.trim() !== '') return true
    if (n.type && n.type !== 'doc' && n.type !== 'paragraph' && !n.content) return true
    return Array.isArray(n.content) && n.content.some(walk)
  }
  return walk(data)
}

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

export function TemplateBlockEditor({
  templateId,
  contents: initialContents,
}: {
  templateId: string
  contents: WizardContentData[]
}) {
  const router = useRouter()
  const [contents, setContents] = useState(initialContents)
  const [busy, setBusy] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const titleHandledRef = useRef(false)
  const contentsRef = useRef(contents)
  contentsRef.current = contents

  const base = `/api/admin/hiring-templates/${templateId}/contents`

  async function patchContent(contentId: string, body: Record<string, unknown>) {
    const res = await fetch(`${base}/${contentId}`, {
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
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType }),
      })
      if (!res.ok) throw new Error('블록 추가에 실패했습니다')
      const { content } = await res.json()
      setContents((prev) => [...prev, content])
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
      const res = await fetch(`${base}/${contentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제에 실패했습니다')
      setContents((prev) => prev.filter((c) => c.id !== contentId))
      toast.success('블록을 삭제했습니다')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제에 실패했습니다')
    }
  }

  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= contents.length) return
    const next = [...contents]
    ;[next[index], next[target]] = [next[target], next[index]]
    const reordered = next.map((c, i) => ({ ...c, sortOrder: i }))
    setContents(reordered)
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

  function startEditTitle(c: WizardContentData) {
    titleHandledRef.current = false
    setEditingTitleId(c.id)
    setTitleDraft(c.title ?? '')
  }
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
    setContents((cur) => cur.map((c) => (c.id === contentId ? { ...c, title } : c)))
    try {
      await patchContent(contentId, { title })
    } catch {
      toast.error('제목 저장에 실패했습니다')
      setContents((cur) => cur.map((c) => (c.id === contentId ? { ...c, title: prev } : c)))
    }
  }

  function handleTextChange(contentId: string, doc: unknown) {
    setContents((cur) => cur.map((c) => (c.id === contentId ? { ...c, data: doc } : c)))
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
      setContents((cur) =>
        cur.map((c) => (c.id === contentId ? { ...c, imagePath: updated.imagePath } : c))
      )
      toast.success('이미지를 업로드했습니다')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다')
    }
  }

  function handleButtonSave(contentId: string, data: ButtonData) {
    setContents((cur) => cur.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
  }

  function handleImageLinkSave(contentId: string, link: BlockLink) {
    const data = { link }
    setContents((cur) => cur.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
  }

  function handleDesignLinkSave(contentId: string, link: BlockLink) {
    const current = contentsRef.current.find((c) => c.id === contentId)
    const scene =
      current?.data && typeof current.data === 'object'
        ? (current.data as Record<string, unknown>)
        : {}
    const data = { ...scene, link }
    setContents((cur) => cur.map((c) => (c.id === contentId ? { ...c, data } : c)))
    return patchContent(contentId, { data })
  }

  async function handleDesignSave(contentId: string, scene: ExcalidrawScene, imageBase64: string) {
    const existingLink = (
      contentsRef.current.find((c) => c.id === contentId)?.data as
        | { link?: BlockLink }
        | null
        | undefined
    )?.link
    const nextScene: ExcalidrawScene = existingLink ? { ...scene, link: existingLink } : scene
    const payloadChars = JSON.stringify(nextScene).length + imageBase64.length
    if (payloadChars > 4 * 1024 * 1024) {
      toast.error('디자인이 너무 큽니다. 캔버스에 넣은 이미지 수·크기를 줄여주세요')
      return
    }
    try {
      const updated = await patchContent(contentId, { data: nextScene, imageBase64 })
      setContents((cur) =>
        cur.map((c) =>
          c.id === contentId ? { ...c, data: nextScene, imagePath: updated.imagePath } : c
        )
      )
      toast.success('디자인을 저장했습니다')
    } catch {
      toast.error('디자인 저장에 실패했습니다')
    }
  }

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

  const editingBlock = editingBlockId
    ? (contents.find((c) => c.id === editingBlockId) ?? null)
    : null

  // 우측 미리보기 대상 — 빈 블록/미지원 타입은 실제 공고에서도 아무것도 렌더하지 않으므로 제외.
  // positions는 예외: 실제 공고에 적용되면 렌더되는 블록이라 통째로 숨기면 "이 블록이 결과물에
  // 없다"는 오해를 줄 수 있어, 아래 렌더에서 placeholder로 표시한다(제외하지 않음).
  const previewableContents = contents.filter(
    (c) =>
      Boolean(CONTENT_TYPE_META[c.contentType as ContentType]) &&
      (c.contentType === 'positions' || blockHasContent(c))
  )

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[38fr_62fr]">
        <div className="space-y-4">
          {contents.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              블록이 없습니다. 아래에서 블록을 추가하세요.
            </div>
          )}

          <div className="space-y-3">
            {contents.map((c, idx) => {
              const meta = CONTENT_TYPE_META[c.contentType as ContentType]
              // 'positions' 는 실제 공고 종속 블록 — 샘플 템플릿에서는 편집 불가(삭제만 허용).
              const isEditable = Boolean(meta) && c.contentType !== 'positions'
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
                      {isEditable && (
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

                  {!isEditable ? (
                    <p className="text-xs text-muted-foreground">
                      {meta
                        ? '직무 정보 블록은 실제 공고에 종속되어 이 화면에서 편집할 수 없습니다. 삭제만 가능합니다.'
                        : '지원하지 않는 블록입니다. 삭제 후 새 블록을 추가하세요.'}
                    </p>
                  ) : blockHasContent(c) ? (
                    <div className="pointer-events-none max-h-32 overflow-hidden rounded-md border bg-muted/20 p-3">
                      <ContentBlockPreview content={c} positions={[]} />
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
              {ADDABLE_TYPES.map(({ type, icon: ItemIcon, label }) => (
                <DropdownMenuItem key={type} onClick={() => handleAdd(type)}>
                  <ItemIcon /> {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-3 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto">
          <PreviewFrame>
            {previewableContents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                블록을 추가하면 여기에 미리보기가 표시됩니다.
              </div>
            ) : (
              <Card className="rounded-xl">
                <CardContent className="space-y-6">
                  {previewableContents.map((c) =>
                    c.contentType === 'positions' ? (
                      <div
                        key={c.id}
                        className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground"
                      >
                        직무 정보 — 공고에 적용하면 이 위치에 모집 직무가 표시됩니다.
                      </div>
                    ) : (
                      <ContentBlockPreview key={c.id} content={c} positions={[]} />
                    )
                  )}
                </CardContent>
              </Card>
            )}
          </PreviewFrame>
        </div>
      </div>

      <BlockEditOverlay
        open={editingBlockId !== null}
        content={editingBlock}
        postingId=""
        positions={[]}
        spacePositions={[]}
        onPositionsChange={() => {}}
        onClose={handleOverlayClose}
        onTextChange={handleTextChange}
        onButtonSave={handleButtonSave}
        onImageSelect={handleImageSelect}
        onImageLinkSave={handleImageLinkSave}
        onDesignSave={handleDesignSave}
        onDesignLinkSave={handleDesignLinkSave}
      />
    </>
  )
}
