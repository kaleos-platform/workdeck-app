'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Editor } from '@/components/sc/editor/editor'
import type { ButtonData } from '@/lib/validations/hiring-posts'
import {
  ButtonBlock,
  DesignBlock,
  ImageBlock,
  PositionsBlock,
  CONTENT_TYPE_META,
} from './block-editors'
import type { ExcalidrawScene } from './excalidraw-canvas'
import type { WizardContentData, WizardPositionData } from './build-types'

type Props = {
  open: boolean
  content: WizardContentData | null
  positions: WizardPositionData[]
  onClose: () => void
  onTextChange: (contentId: string, doc: unknown) => void
  onButtonSave: (contentId: string, data: ButtonData) => Promise<unknown>
  onImageSelect: (contentId: string, file: File) => void
  onDesignSave: (contentId: string, scene: ExcalidrawScene, imageBase64: string) => Promise<void>
}

// 블록 본문 편집 풀스크린 오버레이 — 라우트가 아니라 클라이언트 모달이므로 wizard state 가
// 그대로 유지된다(재동기화·리페치 없음). 저장은 리스트의 기존 핸들러로 onChange 갱신.
export function BlockEditOverlay({
  open,
  content,
  positions,
  onClose,
  onTextChange,
  onButtonSave,
  onImageSelect,
  onDesignSave,
}: Props) {
  const meta = content
    ? CONTENT_TYPE_META[content.contentType as keyof typeof CONTENT_TYPE_META]
    : null
  const heading = content?.title?.trim() || (meta ? `${meta.label} 블록` : '블록 편집')

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <DialogTitle>{heading}</DialogTitle>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {content && (
            <div className="mx-auto w-full max-w-3xl">
              {content.contentType === 'text' ? (
                <Editor
                  key={content.id}
                  initialDoc={content.data ?? undefined}
                  editable
                  variant="full"
                  onChange={(doc) => onTextChange(content.id, doc)}
                />
              ) : content.contentType === 'button' ? (
                <ButtonBlock
                  data={content.data as ButtonData | null}
                  onSave={(data) => onButtonSave(content.id, data)}
                />
              ) : content.contentType === 'image' ? (
                <ImageBlock
                  imagePath={content.imagePath}
                  onSelect={(file) => onImageSelect(content.id, file)}
                />
              ) : content.contentType === 'positions' ? (
                <PositionsBlock positions={positions.map((p) => ({ id: p.id, name: p.name }))} />
              ) : content.contentType === 'design' ? (
                <div className="mx-auto w-fit">
                  <p className="mb-2 text-xs text-muted-foreground">
                    카드저장을 눌러야 저장됩니다. 저장하지 않고 닫으면 변경 사항이 사라집니다.
                  </p>
                  <DesignBlock
                    key={content.id}
                    scene={content.data}
                    onSave={(scene, imageBase64) => onDesignSave(content.id, scene, imageBase64)}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">지원하지 않는 블록입니다.</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
