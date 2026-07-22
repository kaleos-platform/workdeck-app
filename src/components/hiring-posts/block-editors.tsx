'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Type, ImageIcon, Upload, MousePointerClick, Briefcase, Shapes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { BUTTON_DEFAULT_COLOR, BUTTON_PRESET_COLORS } from '@/lib/hiring/button-color'
import { AutoSaveIndicator } from './autosave-indicator'
import { getPostingAssetPublicUrl, DEFAULT_CANVAS_HEIGHT } from './build-types'
import { buttonDataSchema, type ButtonData } from '@/lib/validations/hiring-posts'
import type { ExcalidrawScene } from './excalidraw-canvas'

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
      <div className="flex h-[520px] items-center justify-center rounded-lg border text-sm text-muted-foreground">
        캔버스 불러오는 중…
      </div>
    ),
  }
)

export function ButtonBlock({
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

  // pending debounce 의 최신 초안 — 오버레이가 debounce 창(600ms) 안에 닫혀도 unmount cleanup 에서
  // 이 값을 그대로 flush 한다(state 클로저가 아니라 ref 라 항상 최신).
  const draftRef = useRef<ButtonDraft>({ title, linkType, url, color })
  draftRef.current = { title, linkType, url, color }
  const pendingRef = useRef(false)

  function attemptSave(next: ButtonDraft) {
    pendingRef.current = false
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
    pendingRef.current = true
    timer.current = setTimeout(() => attemptSave(next), 600)
  }

  useEffect(() => {
    return () => {
      clearTimeout(timer.current)
      // 오버레이가 debounce 창 안에 닫혀 타이머가 취소되면 마지막 입력을 잃으므로 flush.
      if (pendingRef.current) attemptSave(draftRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  scene,
  onSave,
}: {
  scene: unknown
  onSave: (scene: ExcalidrawScene, imageBase64: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
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
    <ExcalidrawCanvas
      initialData={initialData}
      canvasHeight={canvasHeight}
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

export function ImageBlock({
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
