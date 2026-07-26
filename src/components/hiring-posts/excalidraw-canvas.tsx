'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Excalidraw,
  exportToBlob,
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
  customData?: { artboard?: boolean }
}

const isFrame = (e: unknown): boolean => (e as El)?.type === 'frame'
// 아트보드 = 프레임 영역을 흰색으로 채우는 잠금 사각형 sentinel(테두리 없음·직각). 프레임은
// fill 을 지원하지 않아(FRAME_STYLE 하드코딩) 흰 배경·회색 뷰포트 구분을 이 요소로 구현한다.
const isArtboard = (e: unknown): boolean => (e as El)?.customData?.artboard === true
// 프레임·아트보드는 사용자 콘텐츠가 아닌 '틀' — 둘 다 제외해야 빈 캔버스 판정이 정확하다.
const isChrome = (e: unknown): boolean => isFrame(e) || isArtboard(e)

// 재흡수 가드 — 아트보드가 프레임 자식으로 흡수(frameId 부여)되면 z-order 가 무너지므로
// frameId 를 항상 제거해 자식이 아닌 상태를 유지한다.
function stripFrameId(el: unknown): unknown {
  const rest = { ...(el as Record<string, unknown>) }
  rest.frameId = null
  return rest
}

// 콘텐츠(틀 제외) 개수 — 빈 캔버스 판정·StrictMode 복원 판정에 사용(틀 상주가 항상-참을
// 만들어 복원을 스킵하거나 빈 캔버스를 저장 가능하게 만드는 버그 방지).
function contentCount(elements: readonly unknown[]): number {
  return elements.filter((e) => !isChrome(e)).length
}

// 프레임과 동일 위치·크기를 채우는 흰색 아트보드 사각형을 생성한다. 테두리 없음(투명·0폭),
// 직각(roundness null), 잠금. ⚠️ frameId 를 붙이지 않는다(프레임 자식 아님) — 프레임 자식은
// 새 요소 삽입 시 z-order 가 재정렬돼 아트보드가 콘텐츠 위로 올라가 덮어버린다. 자식이 아니면
// 배열 최하단(뒤)에 고정되고, export 는 exportingFrame 크롭이 겹치는 non-frameId 요소를 포함한다.
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
  // 아트보드 위 placeholder 안내 — 빈 캔버스일 때만 프레임 화면좌표에 맞춰 표시(내용 추가 시 숨김).
  const [hint, setHint] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  // Excalidraw 변경 시 프레임의 화면 rect 를 계산해 placeholder 위치를 갱신한다. 빈 캔버스가
  // 아니면 숨김(early return)해 드로잉 중 불필요한 추적을 피한다.
  function handleChange(
    elements: readonly unknown[],
    appState: Parameters<typeof sceneCoordsToViewportCoords>[1]
  ) {
    if (contentCount(elements) > 0) {
      setHint((h) => (h === null ? h : null))
      return
    }
    const frame = elements.find(isFrame) as (El & { width?: number; height?: number }) | undefined
    if (!frame || typeof frame.x !== 'number' || typeof frame.y !== 'number') return
    const tl = sceneCoordsToViewportCoords({ sceneX: frame.x, sceneY: frame.y }, appState)
    const br = sceneCoordsToViewportCoords(
      { sceneX: frame.x + (frame.width ?? CANVAS_WIDTH), sceneY: frame.y + (frame.height ?? 0) },
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
      const frame = content.find(isFrame) as El
      const rest = content.filter((e) => !isFrame(e) && !isArtboard(e))
      // 아트보드는 항상 배열 맨 앞(z-order 최하단)에 둔다 — 기존 것이 있어도 재구성해 순서 고정.
      const artboard =
        content.find(isArtboard) ?? // 기존 아트보드 재사용
        buildArtboard(
          typeof frame.x === 'number' ? frame.x : 0,
          typeof frame.y === 'number' ? frame.y : 0,
          CANVAS_WIDTH,
          clampHeight(canvasHeight)
        )
      // [아트보드(최하단), 프레임, ...콘텐츠] — 아트보드가 항상 콘텐츠 뒤.
      elements = [stripFrameId(artboard), frame, ...rest]
    } else {
      const origin = content.length > 0 ? contentTopLeft(content) : { x: 0, y: 0 }
      const h = clampHeight(canvasHeight)
      const [frameEl] = convertToExcalidrawElements([
        {
          type: 'frame',
          children: [],
          x: origin.x,
          y: origin.y,
          width: CANVAS_WIDTH,
          height: h,
          locked: true,
          name: '카드 영역',
        },
      ])
      const artboard = buildArtboard(origin.x, origin.y, CANVAS_WIDTH, h)
      elements = [artboard, frameEl, ...content]
    }
    return {
      elements: elements as never,
      appState: {
        ...(initialData?.appState as object | undefined),
        // 편집 뷰포트는 회색 — 흰색 아트보드(사각형 sentinel)와 색으로만 구분된다.
        // 저장 카드는 아트보드 흰 배경 + handleSave export 흰색 강제로 항상 흰색.
        viewBackgroundColor: '#f4f4f5',
        // 프레임 외곽선(회색·둥근 모서리) 숨김 — 아트보드 흰색만으로 작업 영역 구분. clip 은 유지.
        frameRendering: { enabled: true, clip: true, name: false, outline: false },
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
    // 프레임과 아트보드(흰 배경)를 함께 리사이즈 — 둘은 항상 같은 규격(640×h)을 유지한다.
    const next = elements.map((e) =>
      isChrome(e) ? { ...(e as object), width: CANVAS_WIDTH, height: h } : e
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
    if (contentCount(elements) === 0) {
      toast.error('내용이 없는 캔버스는 저장할 수 없습니다')
      return
    }
    const frame = elements.find(isFrame)
    try {
      const blob = await exportToBlob({
        elements,
        // 저장 카드는 항상 흰색 배경 — 편집 뷰포트의 회색(viewBackgroundColor)이 크롭 영역에
        // 새어나가지 않도록 export 호출에서만 흰색을 강제한다.
        appState: { ...appState, viewBackgroundColor: '#ffffff', exportBackground: true },
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
