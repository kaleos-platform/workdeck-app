'use client'

import { useState } from 'react'
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import { toast } from 'sonner'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

// 저장되는 scene JSON 형태 (Map 이 섞인 전체 appState 대신 직렬화 안전한 부분집합만 보관)
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
        appState,
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
      <div className="h-[480px] overflow-hidden rounded-lg border">
        <Excalidraw excalidrawAPI={setApi} initialData={initialData} />
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !api}>
          <Save /> 저장
        </Button>
      </div>
    </div>
  )
}
