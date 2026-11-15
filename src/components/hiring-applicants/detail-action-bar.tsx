'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  ContactDialog,
  type ContactNotification,
} from '@/components/hiring-applicants/contact-dialog'
import { StageChangeDialog } from '@/components/hiring-applicants/stage-change-dialog'
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
}

// 지원자 상세 하단 고정 액션 — 본문 열 안에서 sticky 로 뷰포트 아래에 붙는다(사이드바와 겹치지 않음).
export function DetailActionBar({
  applicationId,
  stage,
  hiringStage,
  phone,
  name,
  postingTitle,
  positionName,
  notifications,
}: Props) {
  const [stageOpen, setStageOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)

  return (
    <>
      <div className="sticky bottom-0 z-10 -mx-1 mt-auto flex justify-center gap-2 border-t bg-background px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] max-sm:[&>button]:flex-1">
        <Button variant="outline" onClick={() => setStageOpen(true)}>
          모집 단계 변경
        </Button>
        <Button onClick={() => setContactOpen(true)}>연락하기</Button>
      </div>
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
    </>
  )
}
