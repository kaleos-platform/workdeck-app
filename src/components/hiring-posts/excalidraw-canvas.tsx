'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Excalidraw,
  exportToBlob,
  convertToExcalidrawElements,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  BinaryFileData,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { toast } from 'sonner'
import { Save, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from './build-types'

// 아트보드 규격 — 폭은 640 고정, 높이만 조절 (상수는 build-types 에서 공유)
export { CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT }
const MIN_CANVAS_HEIGHT = 200
const MAX_CANVAS_HEIGHT = 2000

// 저장되는 scene JSON 형태 (직렬화 안전한 부분집합). canvasHeight 는 최상위에 저장 —
// 서버는 data(z.unknown())로 통째 저장하므로 스키마/마이그레이션 변경 불필요.
export type ExcalidrawScene = {
  elements: readonly unknown[]
  appState: { viewBackgroundColor?: string }
  files: unknown
  canvasHeight?: number
}

function clampHeight(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_CANVAS_HEIGHT
  return Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, Math.round(v)))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

type El = Record<string, unknown> & { type?: string; x?: number; y?: number }

const isFrame = (e: unknown): boolean => (e as El)?.type === 'frame'

// 프레임 제외 요소 개수 — 빈 캔버스 판정·StrictMode 복원 판정에 사용(프레임 상주가 항상-참을
// 만들어 복원을 스킵하는 버그 방지).
function nonFrameCount(elements: readonly unknown[]): number {
  return elements.filter((e) => !isFrame(e)).length
}

// 레거시(프레임 없는) scene 의 콘텐츠 bbox 좌상단 — 그 위치에 프레임을 주입한다.
function contentTopLeft(elements: readonly unknown[]): { x: number; y: number } {
  let minX = Infinity
  let minY = Infinity
  for (const e of elements) {
    const el = e as El
    if (typeof el.x === 'number') minX = Math.min(minX, el.x)
    if (typeof el.y === 'number') minY = Math.min(minY, el.y)
  }
  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
  }
}

type Props = {
  initialData: ExcalidrawInitialDataState | null
  canvasHeight: number
  saving: boolean
  onSave: (scene: ExcalidrawScene, imageBase64: string) => void
}

// 공고 상세 디자인 캔버스 — next/dynamic(ssr:false) 로만 마운트한다.
export function ExcalidrawCanvas({ initialData, canvasHeight, saving, onSave }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [height, setHeight] = useState(() => clampHeight(canvasHeight))
  // 입력 필드는 빈 문자열(지우는 중)을 허용 — height(적용값)는 유효한 숫자일 때만 갱신한다.
  const [heightInput, setHeightInput] = useState(() => String(clampHeight(canvasHeight)))

  function handleHeightInputChange(value: string) {
    setHeightInput(value)
    if (value === '') return
    const n = Number(value)
    if (Number.isFinite(n)) setHeight(n)
  }

  // 재편집 복원용 initialData + 프레임 주입(잠금, 640×height, scene 상주).
  // ⚠️ 저장된 element 의 fractional `index`("a0" 등)를 그대로 넘기면 restore 가 element 를
  // 드롭해 빈 캔버스가 된다 → index 제거(배열 순서=z-order 재생성). 프레임이 이미 있으면
  // 재주입하지 않는다(저장→재편집 반복 시 프레임 누적 방지).
  const restored = useMemo<ExcalidrawInitialDataState>(() => {
    const raw = initialData?.elements ?? []
    const content = raw.map((e) => {
      const rest = { ...(e as Record<string, unknown>) }
      delete rest.index
      return rest
    })
    const hasFrame = content.some(isFrame)
    let elements: unknown[]
    if (hasFrame) {
      elements = content
    } else {
      const origin = content.length > 0 ? contentTopLeft(content) : { x: 0, y: 0 }
      const [frameEl] = convertToExcalidrawElements([
        {
          type: 'frame',
          children: [],
          x: origin.x,
          y: origin.y,
          width: CANVAS_WIDTH,
          height: clampHeight(canvasHeight),
          locked: true,
          name: '카드 영역',
        },
      ])
      elements = [frameEl, ...content]
    }
    return {
      elements: elements as never,
      appState: {
        ...(initialData?.appState as object | undefined),
        // 편집 중 프레임 외곽선만 표시(export 시엔 라이브러리가 clip:true·outline:false 강제).
        frameRendering: { enabled: true, clip: true, name: false, outline: true },
      },
      files: initialData?.files,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData])

  // 마운트 후 프레임(아트보드)으로 스크롤 — 레거시 scene 도 프레임 위치로 이동.
  // 안전망: dev StrictMode 이중 마운트로 initialData 가 유실돼 빈 캔버스가 되면 복원 재적용.
  useEffect(() => {
    if (!api) return
    const id = setTimeout(() => {
      const current = api.getSceneElements()
      if (nonFrameCount(current) === 0 && nonFrameCount(restored.elements ?? []) > 0) {
        if (restored.files) {
          const list = Object.values(restored.files) as BinaryFileData[]
          if (list.length > 0) api.addFiles(list)
        }
        api.updateScene({
          elements: restored.elements as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      }
      const frame = api.getSceneElements().find(isFrame)
      if (frame) api.scrollToContent([frame], { fitToContent: true, animate: false })
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // 설정 — 프레임 높이 갱신(폭 640 강제).
  function applyCanvasSize() {
    if (!api) return
    const h = clampHeight(height)
    setHeight(h)
    setHeightInput(String(h))
    const elements = api.getSceneElements()
    if (!elements.some(isFrame)) return
    const next = elements.map((e) =>
      isFrame(e) ? { ...(e as object), width: CANVAS_WIDTH, height: h } : e
    )
    api.updateScene({ elements: next as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    const frame = next.find(isFrame)
    if (frame) api.scrollToContent([frame] as never, { fitToContent: true, animate: false })
  }

  async function handleSave() {
    if (!api) return
    const elements = api.getSceneElements()
    const appState = api.getAppState()
    const files = api.getFiles()
    if (nonFrameCount(elements) === 0) {
      toast.error('내용이 없는 캔버스는 저장할 수 없습니다')
      return
    }
    const frame = elements.find(isFrame)
    try {
      const blob = await exportToBlob({
        elements,
        appState,
        files,
        // 아트보드(640×height)만 정확히 크롭 — 프레임과 겹치는(frameId 없는) 요소 포함, 밖은 클립.
        exportingFrame: (frame as never) ?? null,
        exportPadding: 0,
        // exportingFrame 사용 시 appState.exportScale 은 무시된다 — getDimensions 로 2x 강제.
        // (w,h)=프레임 크롭 치수(640×height) → 2배로 확대해 고해상도 PNG 생성.
        getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
        mimeType: 'image/png',
      })
      const imageBase64 = await blobToBase64(blob)
      const scene: ExcalidrawScene = {
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
        canvasHeight: clampHeight(height),
      }
      onSave(scene, imageBase64)
    } catch {
      toast.error('캔버스 이미지 변환에 실패했습니다')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="canvas-height" className="text-xs">
              캔버스 높이
            </Label>
            <Input
              id="canvas-height"
              type="number"
              min={MIN_CANVAS_HEIGHT}
              max={MAX_CANVAS_HEIGHT}
              value={heightInput}
              onChange={(e) => handleHeightInputChange(e.target.value)}
              onBlur={() => {
                setHeight((h) => {
                  const clamped = clampHeight(h)
                  setHeightInput(String(clamped))
                  return clamped
                })
              }}
              className="h-8 w-28"
            />
          </div>
          <Button size="sm" variant="outline" onClick={applyCanvasSize} disabled={!api}>
            <Settings2 /> 설정
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          폭 640px 고정 · 아트보드(점선 프레임) 안에 그린 내용이 카드로 저장됩니다.
        </p>
      </div>
      <div className="h-[520px] overflow-hidden rounded-lg border">
        <Excalidraw excalidrawAPI={setApi} initialData={restored} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !api}>
          <Save /> 카드저장
        </Button>
      </div>
    </div>
  )
}
