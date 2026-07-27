'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Excalidraw,
  exportToCanvas,
  getCommonBounds,
  convertToExcalidrawElements,
  sceneCoordsToViewportCoords,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  BinaryFileData,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from './build-types'

// 아트보드 규격 — 폭은 640 고정, 높이만 조절 (상수는 build-types 에서 공유)
export { CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT }
const MIN_CANVAS_HEIGHT = 200
const MAX_CANVAS_HEIGHT = 2000
const EXPORT_SCALE = 2

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

type El = Record<string, unknown> & {
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  customData?: { artboard?: boolean }
}

const isFrame = (e: unknown): boolean => (e as El)?.type === 'frame'
// 아트보드 = 카드 영역(640×height)을 정의하는 흰색 잠금 사각형(테두리 없음·직각). 카드 경계이자
// export 크롭 기준이다. ⚠️ Excalidraw frame 은 쓰지 않는다 — FRAME_STYLE.radius(하드코딩)로
// clip 경계가 둥근 모서리라 코너 콘텐츠가 잘리고, 프레임 위치 보정(-10)으로 정렬이 틀어졌다.
const isArtboard = (e: unknown): boolean => (e as El)?.customData?.artboard === true

// 콘텐츠(아트보드 제외) 개수 — 빈 캔버스 판정·StrictMode 복원 판정에 사용.
function contentCount(elements: readonly unknown[]): number {
  return elements.filter((e) => !isArtboard(e)).length
}

// 카드 영역을 정의하는 흰색 아트보드 사각형을 생성한다. 테두리 없음(투명·0폭), 직각(roundness
// null), 잠금. 배열 최하단(z-order 뒤)에 두어 콘텐츠가 항상 그 위에 그려진다.
function buildArtboard(x: number, y: number, width: number, height: number): unknown {
  const [rect] = convertToExcalidrawElements([
    { type: 'rectangle', x, y, width, height, backgroundColor: '#ffffff' },
  ])
  return {
    ...(rect as object),
    backgroundColor: '#ffffff',
    fillStyle: 'solid',
    strokeColor: 'transparent',
    strokeWidth: 0,
    roundness: null,
    locked: true,
    customData: { artboard: true },
  }
}

// 레거시(아트보드 없는) scene 의 콘텐츠 bbox 좌상단 — 그 위치에 아트보드를 주입한다.
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
  // 아트보드 위 placeholder 안내 — 빈 캔버스일 때만 아트보드 화면좌표에 맞춰 표시(내용 추가 시 숨김).
  const [hint, setHint] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  // Excalidraw 변경 시 아트보드의 화면 rect 를 계산해 placeholder 위치를 갱신한다. 빈 캔버스가
  // 아니면 숨김(early return)해 드로잉 중 불필요한 추적을 피한다.
  function handleChange(
    elements: readonly unknown[],
    appState: Parameters<typeof sceneCoordsToViewportCoords>[1]
  ) {
    if (contentCount(elements) > 0) {
      setHint((h) => (h === null ? h : null))
      return
    }
    const board = elements.find(isArtboard) as El | undefined
    if (!board || typeof board.x !== 'number' || typeof board.y !== 'number') return
    const tl = sceneCoordsToViewportCoords({ sceneX: board.x, sceneY: board.y }, appState)
    const br = sceneCoordsToViewportCoords(
      { sceneX: board.x + (board.width ?? CANVAS_WIDTH), sceneY: board.y + (board.height ?? 0) },
      appState
    )
    const next = {
      left: Math.round(tl.x - appState.offsetLeft),
      top: Math.round(tl.y - appState.offsetTop),
      width: Math.round(br.x - tl.x),
      height: Math.round(br.y - tl.y),
    }
    // 값이 실제로 바뀔 때만 갱신 — onChange 는 매 렌더마다 호출되므로 무조건 setState 하면
    // setState→렌더→onChange 무한 루프(Maximum update depth)에 빠진다.
    setHint((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next
    )
  }

  function handleHeightInputChange(value: string) {
    setHeightInput(value)
    if (value === '') return
    const n = Number(value)
    if (Number.isFinite(n)) setHeight(n)
  }

  // 재편집 복원용 initialData + 아트보드 주입(직각 흰 사각형, 640×height, z-order 최하단).
  // ⚠️ 저장된 element 의 fractional `index`("a0" 등)를 그대로 넘기면 restore 가 element 를
  // 드롭해 빈 캔버스가 된다 → index 제거. 레거시 scene 의 frame 요소는 제거한다(더 이상 사용
  // 안 함; 재저장 시 JSON 에서 정리됨).
  const restored = useMemo<ExcalidrawInitialDataState>(() => {
    const raw = initialData?.elements ?? []
    const content = raw
      .map((e) => {
        const rest = { ...(e as Record<string, unknown>) }
        delete rest.index
        return rest
      })
      .filter((e) => !isFrame(e))
    const board = content.find(isArtboard)
    let elements: unknown[]
    if (board) {
      // 기존 아트보드 유지 + 최하단(배열 맨 앞)으로 고정.
      elements = [board, ...content.filter((e) => !isArtboard(e))]
    } else {
      const origin = content.length > 0 ? contentTopLeft(content) : { x: 0, y: 0 }
      const artboard = buildArtboard(origin.x, origin.y, CANVAS_WIDTH, clampHeight(canvasHeight))
      elements = [artboard, ...content]
    }
    return {
      elements: elements as never,
      appState: {
        ...(initialData?.appState as object | undefined),
        // 편집 뷰포트는 회색 — 흰색 아트보드와 색으로만 구분된다. 저장 카드는 흰색(handleSave).
        viewBackgroundColor: '#f4f4f5',
        // 새로 그리는 도형의 기본 모서리를 직각으로 — Excalidraw 기본값('round')은 사각형이
        // 둥근 모서리로 그려져 카드 디자인에 부적합(사용자가 원하면 Edges 패널에서 변경 가능).
        currentItemRoundness: 'sharp',
      },
      files: initialData?.files,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData])

  // 마운트 후 아트보드로 스크롤·맞춤. 안전망: dev StrictMode 이중 마운트로 initialData 가
  // 유실돼 빈 캔버스가 되면 복원 재적용.
  useEffect(() => {
    if (!api) return
    const id = setTimeout(() => {
      const current = api.getSceneElements()
      if (contentCount(current) === 0 && contentCount(restored.elements ?? []) > 0) {
        if (restored.files) {
          const list = Object.values(restored.files) as BinaryFileData[]
          if (list.length > 0) api.addFiles(list)
        }
        api.updateScene({
          elements: restored.elements as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      }
      const board = api.getSceneElements().find(isArtboard)
      if (board) api.scrollToContent([board], { fitToContent: true, animate: false })
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // 적용 — 아트보드 높이 갱신(폭 640 고정, 위치 유지).
  function applyCanvasSize() {
    if (!api) return
    const h = clampHeight(height)
    setHeight(h)
    setHeightInput(String(h))
    const elements = api.getSceneElements()
    if (!elements.some(isArtboard)) return
    const next = elements.map((e) =>
      isArtboard(e) ? { ...(e as object), width: CANVAS_WIDTH, height: h } : e
    )
    api.updateScene({ elements: next as never, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    const board = next.find(isArtboard)
    if (board) api.scrollToContent([board] as never, { fitToContent: true, animate: false })
  }

  async function handleSave() {
    if (!api) return
    const elements = api.getSceneElements()
    const appState = api.getAppState()
    const files = api.getFiles()
    if (contentCount(elements) === 0) {
      toast.error('내용이 없는 캔버스는 저장할 수 없습니다')
      return
    }
    const board = elements.find(isArtboard) as El | undefined
    if (!board || typeof board.x !== 'number' || typeof board.y !== 'number') {
      toast.error('아트보드를 찾을 수 없습니다')
      return
    }
    const bw = typeof board.width === 'number' ? board.width : CANVAS_WIDTH
    const bh = typeof board.height === 'number' ? board.height : clampHeight(height)
    try {
      // 전체 씬을 흰 배경으로 2x 렌더 → 아트보드(직각) 영역만 잘라 카드로 만든다. Excalidraw
      // frame 을 쓰지 않으므로 둥근 clip 없이 정확한 직각 크롭이 된다.
      const rendered = await exportToCanvas({
        elements,
        appState: { ...appState, viewBackgroundColor: '#ffffff', exportBackground: true },
        files,
        exportPadding: 0,
        getDimensions: (w: number, h: number) => ({
          width: w * EXPORT_SCALE,
          height: h * EXPORT_SCALE,
          scale: EXPORT_SCALE,
        }),
      })
      // 렌더 캔버스 원점 = 전체 요소 공통 bbox 좌상단(getCommonBounds). 아트보드의 픽셀 위치를
      // 계산해 640×height 영역만 잘라낸다(밖으로 나간 콘텐츠는 자동 크롭).
      const [minX, minY] = getCommonBounds(elements as never)
      const out = document.createElement('canvas')
      out.width = Math.round(bw * EXPORT_SCALE)
      out.height = Math.round(bh * EXPORT_SCALE)
      const ctx = out.getContext('2d')
      if (!ctx) throw new Error('no 2d context')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(
        rendered,
        Math.round((board.x - minX) * EXPORT_SCALE),
        Math.round((board.y - minY) * EXPORT_SCALE),
        out.width,
        out.height,
        0,
        0,
        out.width,
        out.height
      )
      const blob: Blob | null = await new Promise((res) => out.toBlob((b) => res(b), 'image/png'))
      if (!blob) throw new Error('toBlob failed')
      const imageBase64 = await blobToBase64(blob)
      const scene: ExcalidrawScene = {
        elements,
        // 편집 회색값을 데이터에 남기지 않음 — 카드/재편집 모두 흰색 기준. 재편집 시엔
        // restored 가 다시 회색으로 오버라이드하므로 편집 뷰는 동일하게 회색.
        appState: { viewBackgroundColor: '#ffffff' },
        files,
        canvasHeight: clampHeight(height),
      }
      onSave(scene, imageBase64)
    } catch {
      toast.error('캔버스 이미지 변환에 실패했습니다')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
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
            적용
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-muted-foreground lg:block">
            폭 640px 고정 · 흰색 아트보드 안에 그린 내용이 카드로 저장됩니다 · 카드저장을 눌러야
            반영됩니다
          </p>
          <Button size="sm" onClick={handleSave} disabled={saving || !api}>
            <Save /> 카드저장
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
        <Excalidraw excalidrawAPI={setApi} initialData={restored} onChange={handleChange} />
        {hint && (
          <div
            className="pointer-events-none absolute z-[3] flex items-center justify-center p-4 text-center"
            style={{ left: hint.left, top: hint.top, width: hint.width, height: hint.height }}
          >
            <p className="text-sm leading-relaxed break-keep text-muted-foreground">
              폭 640px 고정 · 흰색 아트보드 안에 그린 내용이 카드로 저장됩니다 · 카드저장을 눌러야
              반영됩니다
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
