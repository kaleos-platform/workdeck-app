'use client'

import { useEffect, useRef, useState } from 'react'
import { Excalidraw, convertToExcalidrawElements, serializeAsJSON } from '@excalidraw/excalidraw'
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'
import '@/components/hiring-posts/excalidraw-korean-fonts.css'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0]

// 에이전트는 라벨을 쓰기 쉬운 skeleton 요소로 그릴 수 있다. seed 가 없으면 skeleton 으로 보고 변환한다.
function normalizeScene(scene: ExcalidrawInitialDataState): ExcalidrawInitialDataState {
  const elements = (scene.elements ?? []) as readonly { seed?: number }[]
  if (elements.every((element) => element.seed !== undefined)) return scene
  return {
    ...scene,
    elements: convertToExcalidrawElements(elements as Skeleton, { regenerateIds: false }),
  }
}

export function PlanCanvas({ task, screen }: { task: string; screen: string }) {
  const url = `/api/dev/plan/${task}/${screen}`
  const [scene, setScene] = useState<ExcalidrawInitialDataState | null>(null)
  const [saving, setSaving] = useState(false)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const fittedRef = useRef(false)

  useEffect(() => {
    let active = true
    fetch(url)
      .then((response) => response.json())
      .then((data) => active && setScene(normalizeScene(data)))
      .catch(() => toast.error('와이어프레임을 읽지 못했습니다'))
    return () => {
      active = false
    }
  }, [url])

  async function save() {
    const api = apiRef.current
    if (!api) return
    setSaving(true)
    const body = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local')
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => null)
    setSaving(false)
    if (response?.ok) toast.success('저장했습니다')
    else toast.error('저장하지 못했습니다')
  }

  if (!scene) return <p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>
  return (
    <div className="relative h-full">
      <Excalidraw
        initialData={{ ...scene, scrollToContent: true }}
        excalidrawAPI={(api) => {
          apiRef.current = api
        }}
        onChange={() => {
          // 폰에서도 전체가 보이도록 마운트 뒤 첫 변경 때 한 번만 내용에 맞춘다.
          if (fittedRef.current || !apiRef.current) return
          fittedRef.current = true
          apiRef.current.scrollToContent(apiRef.current.getSceneElements(), {
            fitToContent: true,
            viewportZoomFactor: 0.8,
          })
        }}
      />
      <Button className="absolute right-3 bottom-3 z-10" disabled={saving} onClick={save}>
        {saving ? '저장 중…' : '저장'}
      </Button>
    </div>
  )
}
