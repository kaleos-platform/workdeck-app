'use client'

import { useEffect, useState } from 'react'
import { Excalidraw, exportToBlob, CaptureUpdateAction } from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  BinaryFileData,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

// 저장되는 scene JSON 형태 (직렬화 안전한 부분집합)
export type ExcalidrawScene = {
  elements: readonly unknown[]
  appState: { viewBackgroundColor?: string }
  files: unknown
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

type Props = {
  initialData: ExcalidrawInitialDataState | null
  saving: boolean
  onSave: (scene: ExcalidrawScene, imageBase64: string) => void
}

// 공고 상세 캔버스 — next/dynamic(ssr:false) 로만 마운트한다.
export function ExcalidrawCanvas({ initialData, saving, onSave }: Props) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)

  // 재편집 복원용 initialData.
  // ⚠️ 저장된 element 에 남아있는 fractional `index`("a0" 등)를 그대로 넘기면 Excalidraw restore 가
  // 해당 element 를 드롭해 빈 캔버스가 된다. index 를 제거하면 배열 순서(=z-order)로 재생성되어
  // 정상 복원된다. 붙여넣은 이미지(files)·배경(appState)은 함께 전달.
  const restored: ExcalidrawInitialDataState | null =
    initialData?.elements && initialData.elements.length > 0
      ? {
          elements: initialData.elements.map((e) => {
            const rest = { ...(e as Record<string, unknown>) }
            delete rest.index
            return rest
          }) as never,
          appState: initialData.appState,
          files: initialData.files,
          scrollToContent: true,
        }
      : null

  // 안전망: dev StrictMode 이중 마운트 시 initialData 가 유실돼 빈 캔버스가 될 수 있어,
  // API 준비 후 scene 이 비어 있으면 updateScene 으로 복원을 재적용한다(prod 에서는 no-op).
  useEffect(() => {
    if (!api || !restored?.elements) return
    const id = setTimeout(() => {
      if (api.getSceneElements().length > 0) return
      if (restored.files) {
        const list = Object.values(restored.files) as BinaryFileData[]
        if (list.length > 0) api.addFiles(list)
      }
      api.updateScene({ elements: restored.elements, captureUpdate: CaptureUpdateAction.NEVER })
      api.scrollToContent(restored.elements ?? [], { fitToContent: true, animate: false })
    }, 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  async function handleSave() {
    if (!api) return
    const elements = api.getSceneElements()
    const appState = api.getAppState()
    const files = api.getFiles()
    if (elements.length === 0) {
      toast.error('내용이 없는 캔버스는 저장할 수 없습니다')
      return
    }
    try {
      const blob = await exportToBlob({
        elements,
        appState: { ...appState, exportScale: 2 },
        files,
        mimeType: 'image/png',
      })
      const imageBase64 = await blobToBase64(blob)
      const scene: ExcalidrawScene = {
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
      }
      onSave(scene, imageBase64)
    } catch {
      toast.error('캔버스 이미지 변환에 실패했습니다')
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        표시 폭 640px 기준으로 저장됩니다. 너무 작게 그리면 확대 시 흐릴 수 있습니다.
      </p>
      <div className="h-[480px] overflow-hidden rounded-lg border">
        <Excalidraw excalidrawAPI={setApi} initialData={restored} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !api}>
          <Save /> 저장
        </Button>
      </div>
    </div>
  )
}
