'use client'

import { createContext, useContext, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  ContactDialog,
  type ContactNotification,
} from '@/components/hiring-applicants/contact-dialog'
import { StageChangeDialog } from '@/components/hiring-applicants/stage-change-dialog'
import { cn } from '@/lib/utils'
import type { HiringApplicationStage, HiringProcessStage } from '@/generated/prisma/client'

type Props = {
  applicationId: string
  stage: HiringApplicationStage
  hiringStage: HiringProcessStage
  phone: string | null
  name: string | null
  postingTitle: string | null
  positionName: string | null
  notifications: ContactNotification[]
  children: React.ReactNode
}

type Openers = { openStage: () => void; openContact: () => void }

const DetailActionsContext = createContext<Openers | null>(null)

// 지원자 상세 액션(모집 단계 변경·연락하기). 버튼은 데스크톱 헤더와 모바일 하단 바 두 곳에 놓이고,
// 팝업은 여기서 한 번만 띄운다.
export function DetailActionsProvider({
  applicationId,
  stage,
  hiringStage,
  phone,
  name,
  postingTitle,
  positionName,
  notifications,
  children,
}: Props) {
  const [stageOpen, setStageOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)

  return (
    <DetailActionsContext.Provider
      value={{ openStage: () => setStageOpen(true), openContact: () => setContactOpen(true) }}
    >
      {children}
      <StageChangeDialog
        applicationId={applicationId}
        stage={stage}
        hiringStage={hiringStage}
        open={stageOpen}
        onOpenChange={setStageOpen}
      />
      <ContactDialog
        applicationId={applicationId}
        phone={phone}
        name={name}
        postingTitle={postingTitle}
        positionName={positionName}
        notifications={notifications}
        open={contactOpen}
        onOpenChange={setContactOpen}
      />
    </DetailActionsContext.Provider>
  )
}

export function DetailActionButtons({ className }: { className?: string }) {
  const ctx = useContext(DetailActionsContext)
  if (!ctx) return null
  return (
    <div className={cn('flex gap-2', className)}>
      <Button variant="outline" onClick={ctx.openStage}>
        모집 단계 변경
      </Button>
      <Button onClick={ctx.openContact}>연락하기</Button>
    </div>
  )
}

// 모바일 하단 고정 바 — 본문 열 안에서 sticky 로 뷰포트 아래에 붙는다. 데스크톱(lg)은 헤더 버튼을 쓴다.
export function DetailActionBar() {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-auto border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] lg:hidden">
      <DetailActionButtons className="justify-center max-sm:[&>button]:flex-1" />
    </div>
  )
}
