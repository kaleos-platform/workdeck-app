'use client'

import { Check } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Editor } from '@/components/sc/editor/editor'
import type { ButtonData } from '@/lib/validations/hiring-posts'
import { ButtonBlock, DesignBlock, ImageBlock, CONTENT_TYPE_META } from './block-editors'
import { StepPositions } from './step-positions'
import type { ExcalidrawScene } from './excalidraw-canvas'
import type { WizardContentData, WizardPositionData, WizardPosition } from './build-types'

type Props = {
  open: boolean
  content: WizardContentData | null
  postingId: string
  positions: WizardPositionData[]
  spacePositions: WizardPosition[]
  onPositionsChange: (positions: WizardPositionData[]) => void
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
  postingId,
  positions,
  spacePositions,
  onPositionsChange,
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
  // 이미지·버튼은 입력이 적어 중앙 컴팩트 팝업으로. 텍스트/디자인/직무는 넓은 풀스크린 오버레이 유지.
  const isPopup = content?.contentType === 'button' || content?.contentType === 'image'
  // 디자인 블록은 캔버스가 오버레이 전폭·전고를 채우도록 폭 제한/스크롤을 제거하고 flex 로 높이 전달.
  const isDesign = content?.contentType === 'design'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className={
          isPopup
            ? 'flex max-h-[85vh] w-full max-w-lg flex-col gap-0 p-0'
            : 'flex h-dvh w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0'
        }
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <DialogTitle>{heading}</DialogTitle>
          {/* 텍스트·직무 블록은 입력이 즉시 반영되므로, 명시적으로 편집을 끝내는 '완료' 버튼을
              제공한다(우측 X 닫기 아이콘과 겹치지 않도록 여백). 디자인 블록은 '카드저장',
              이미지·버튼(팝업)은 자체 저장 버튼이 있어 제외. */}
          {!isPopup && !isDesign && (
            <Button size="sm" className="mr-8" onClick={onClose}>
              <Check /> 완료
            </Button>
          )}
        </div>
        <div
          className={
            isDesign ? 'flex min-h-0 flex-1 flex-col p-4' : 'min-h-0 flex-1 overflow-y-auto p-6'
          }
        >
          {content && (
            <div
              className={
                isPopup
                  ? 'w-full'
                  : isDesign
                    ? 'mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col'
                    : 'mx-auto w-full max-w-3xl'
              }
            >
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
                // 기본 정보 화면과 동일한 직무 관리 UI(직무 추가 팝업 + 목록/편집/삭제) 재사용.
                <StepPositions
                  postingId={postingId}
                  positions={positions}
                  spacePositions={spacePositions}
                  onChange={onPositionsChange}
                />
              ) : content.contentType === 'design' ? (
                <DesignBlock
                  key={content.id}
                  scene={content.data}
                  onSave={(scene, imageBase64) => onDesignSave(content.id, scene, imageBase64)}
                />
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
