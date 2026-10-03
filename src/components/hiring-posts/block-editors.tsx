'use client'

import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Type, ImageIcon, Upload, MousePointerClick, Briefcase, Shapes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BUTTON_DEFAULT_COLOR, BUTTON_PRESET_COLORS } from '@/lib/hiring/button-color'
import { AutoSaveIndicator } from './autosave-indicator'
import { useQueuedSave, type SaveHandle } from './use-queued-save'
import { getPostingAssetPublicUrl, DEFAULT_CANVAS_HEIGHT } from './build-types'
import {
  blockLinkSchema,
  buttonDataSchema,
  type ButtonData,
  type BlockLink,
} from '@/lib/validations/hiring-posts'
import type { ExcalidrawScene } from './excalidraw-canvas'

const LINK_TYPE_LABELS: Record<BlockLink['linkType'], string> = {
  none: '링크 없음',
  form: '지원서 폼 연결',
  url: 'URL 직접 입력',
}

// image·design 블록 공용 링크 편집기 — ButtonBlock 과 동일한 자동저장 패턴(seed-once state,
// debounce/blur + 편집 완료 전 flush). 'none'/'form' 은 즉시, 'url' 은 입력값 검증 후 저장.
export function BlockLinkEditor({
  ref,
  value,
  onSave,
}: {
  ref?: Ref<SaveHandle>
  value: BlockLink | null | undefined
  onSave: (link: BlockLink) => Promise<unknown>
}) {
  const [linkType, setLinkType] = useState<BlockLink['linkType']>(value?.linkType ?? 'none')
  const [url, setUrl] = useState(value?.url ?? '')
  const [error, setError] = useState<string | null>(null)
  const saver = useQueuedSave(value ?? null, async (next) => {
    await onSave(next!)
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const uid = useId()

  type LinkDraft = { linkType: BlockLink['linkType']; url: string }
  const draftRef = useRef<LinkDraft>({ linkType, url })
  draftRef.current = { linkType, url }
  const pendingRef = useRef(false)

  async function flushDraft(next: LinkDraft) {
    pendingRef.current = false
    clearTimeout(timer.current)
    const result = blockLinkSchema.safeParse({
      linkType: next.linkType,
      url: next.url || undefined,
    })
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '입력 값을 확인하세요'
      setError(message)
      throw new Error(message)
    }
    setError(null)
    await saver.flush(result.data)
  }
  useImperativeHandle(ref, () => ({ flush: () => flushDraft({ linkType, url }) }))

  function attemptSave(next: LinkDraft) {
    void flushDraft(next).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '링크 저장에 실패했습니다')
    })
  }

  function debouncedSave(next: LinkDraft) {
    pendingRef.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => attemptSave(next), 600)
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      // 보호되지 않은 외부 이동에도 마지막 저장은 시도한다. 탭 종료 성공까지 보장하지는 않는다.
      if (pendingRef.current) attemptSave(draftRef.current)
    },
    // 초기 콜백도 동일 큐를 사용하며 최신 값은 ref에서 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  function handleLinkTypeChange(next: BlockLink['linkType']) {
    setLinkType(next)
    clearTimeout(timer.current)
    // url 전환 직후 빈 URL로 즉시 검증하면 에러가 뜨므로 입력을 기다린다
    if (next === 'url' && !url.trim()) {
      setError(null)
      return
    }
    attemptSave({ linkType: next, url })
  }
  function handleUrlChange(value: string) {
    setUrl(value)
    debouncedSave({ linkType, url: value })
  }
  function handleUrlBlur() {
    clearTimeout(timer.current)
    attemptSave({ linkType, url })
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>링크 연결</Label>
        <AutoSaveIndicator status={saver.status} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {(Object.keys(LINK_TYPE_LABELS) as BlockLink['linkType'][]).map((t) => (
          <label key={t} className="flex cursor-pointer items-center gap-1.5">
            <input
              type="radio"
              name={`${uid}-blocklink`}
              value={t}
              checked={linkType === t}
              onChange={() => handleLinkTypeChange(t)}
            />
            {LINK_TYPE_LABELS[t]}
          </label>
        ))}
      </div>
      {linkType === 'url' && (
        <Input
          value={url}
          onChange={(e) => handleUrlChange(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://example.com"
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export type ContentType = 'text' | 'image' | 'button' | 'positions' | 'design'

export const CONTENT_TYPE_META: Record<ContentType, { icon: typeof Type; label: string }> = {
  text: { icon: Type, label: '텍스트' },
  image: { icon: ImageIcon, label: '이미지' },
  button: { icon: MousePointerClick, label: '버튼' },
  positions: { icon: Briefcase, label: '직무 정보' },
  design: { icon: Shapes, label: '디자인' },
}

const ExcalidrawCanvas = dynamic(
  () => import('./excalidraw-canvas').then((m) => m.ExcalidrawCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
        캔버스 불러오는 중…
      </div>
    ),
  }
)

export function ButtonBlock({
  ref,
  data,
  onSave,
}: {
  ref?: Ref<SaveHandle>
  data: ButtonData | null
  onSave: (data: ButtonData) => Promise<unknown>
}) {
  const [title, setTitle] = useState(data?.title ?? '지원하기')
  const [linkType, setLinkType] = useState<'form' | 'url'>(data?.linkType ?? 'form')
  const [url, setUrl] = useState(data?.url ?? '')
  const [color, setColor] = useState(data?.color ?? BUTTON_DEFAULT_COLOR)
  const [error, setError] = useState<string | null>(null)
  const saver = useQueuedSave(data, async (next) => {
    await onSave(next!)
  })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const uid = useId()

  type ButtonDraft = { title: string; linkType: 'form' | 'url'; url: string; color: string }

  const draftRef = useRef<ButtonDraft>({ title, linkType, url, color })
  draftRef.current = { title, linkType, url, color }
  const pendingRef = useRef(false)

  async function flushDraft(next: ButtonDraft) {
    pendingRef.current = false
    clearTimeout(timer.current)
    const result = buttonDataSchema.safeParse({
      linkType: next.linkType,
      url: next.url || undefined,
      title: next.title,
      color: next.color,
    })
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '입력 값을 확인하세요'
      setError(message)
      throw new Error(message)
    }
    setError(null)
    await saver.flush(result.data)
  }
  useImperativeHandle(ref, () => ({ flush: () => flushDraft({ title, linkType, url, color }) }))

  function attemptSave(next: ButtonDraft) {
    void flushDraft(next).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '버튼 저장에 실패했습니다')
    })
  }

  function debouncedSave(next: ButtonDraft) {
    pendingRef.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => attemptSave(next), 600)
  }
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      // 보호되지 않은 외부 이동에도 마지막 저장은 시도한다. 탭 종료 성공까지 보장하지는 않는다.
      if (pendingRef.current) attemptSave(draftRef.current)
    },
    // 초기 콜백도 동일 큐를 사용하며 최신 값은 ref에서 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

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
          <AutoSaveIndicator status={saver.status} />
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

export function PositionsBlock({ positions }: { positions: { id: string; name: string }[] }) {
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

export function DesignBlock({
  ref,
  scene,
  onSave,
  onLinkSave,
  onBusyChange,
}: {
  ref?: Ref<SaveHandle>
  scene: unknown
  onBusyChange?: (busy: boolean) => void
  onSave: (scene: ExcalidrawScene, imageBase64: string) => Promise<void>
  onLinkSave: (link: BlockLink) => Promise<unknown>
}) {
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const linkRef = useRef<SaveHandle>(null)
  const canvasRef = useRef<SaveHandle>(null)
  useImperativeHandle(ref, () => ({
    flush: async () => {
      await linkRef.current?.flush()
      await canvasRef.current?.flush()
    },
  }))
  const link = (scene as { link?: BlockLink } | null)?.link ?? null
  // scene 이 바뀔 때만 재계산 — setSaving 등 무관한 리렌더에서 새 객체를 만들면
  // ExcalidrawCanvas 의 initialData 기반 useMemo 가 매번 무효화된다.
  const { initialData, canvasHeight } = useMemo(() => {
    const obj = scene && typeof scene === 'object' ? (scene as Record<string, unknown>) : null
    // 저장된 scene → excalidraw initialData 복원 (files 포함, 재편집 보장)
    const data =
      obj && 'elements' in obj
        ? {
            elements: obj.elements as never,
            appState: obj.appState as never,
            files: obj.files as never,
          }
        : null
    const height =
      typeof obj?.canvasHeight === 'number' ? (obj.canvasHeight as number) : DEFAULT_CANVAS_HEIGHT
    return { initialData: data, canvasHeight: height }
  }, [scene])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div inert={saving || exporting}>
        <BlockLinkEditor ref={linkRef} value={link} onSave={onLinkSave} />
      </div>
      <div className="min-h-0 flex-1">
        <ExcalidrawCanvas
          ref={canvasRef}
          initialData={initialData}
          canvasHeight={canvasHeight}
          saving={saving}
          onBusyChange={(busy) => {
            setExporting(busy)
            onBusyChange?.(busy)
          }}
          onSave={async (s, img) => {
            setSaving(true)
            try {
              await linkRef.current?.flush()
              await onSave(s, img)
            } finally {
              setSaving(false)
            }
          }}
        />
      </div>
    </div>
  )
}

export function ImageBlock({
  ref,
  imagePath,
  link,
  onSelect,
  onLinkSave,
}: {
  ref?: Ref<SaveHandle>
  imagePath: string | null
  link: BlockLink | null | undefined
  onSelect: (file: File) => Promise<void>
  onLinkSave: (link: BlockLink) => Promise<unknown>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef(false)
  const [uploading, setUploading] = useState(false)
  const [failedFile, setFailedFile] = useState<File | null>(null)

  async function upload(file: File) {
    if (uploadRef.current) return
    uploadRef.current = true
    setUploading(true)
    try {
      await onSelect(file)
      setFailedFile(null)
    } catch (error) {
      setFailedFile(file)
      toast.error(error instanceof Error ? error.message : '이미지 업로드에 실패했습니다')
    } finally {
      uploadRef.current = false
      setUploading(false)
    }
  }
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
          if (file) void upload(file)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload /> {uploading ? '업로드 중…' : imagePath ? '이미지 교체' : '이미지 업로드'}
        </Button>
        <p className="text-xs text-muted-foreground">
          권장: 가로 1280px 이상(표시 폭 640px · 선명도 2x) · JPG/PNG · 10MB 이하. 세로 길이는
          자유입니다.
        </p>
      </div>
      {failedFile && (
        <div role="alert" className="space-y-2 text-sm">
          <p>이미지를 저장하지 못했습니다. 다시 업로드하거나 다른 파일을 선택하세요.</p>
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => void upload(failedFile)}
          >
            이미지 다시 업로드
          </Button>
        </div>
      )}
      <BlockLinkEditor ref={ref} value={link} onSave={onLinkSave} />
    </div>
  )
}
