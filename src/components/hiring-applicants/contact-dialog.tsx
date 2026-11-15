'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Phone } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NOTIFICATION_LABELS } from '@/lib/hiring/application-shared'
import { normalizeSmsPhone } from '@/lib/hiring/message-template'
import { SmsComposer } from '@/components/hiring-applicants/sms-sender'
import { StatusLinkPanel } from '@/components/hiring-applicants/notification-sender'
import type { HiringNotificationType } from '@/generated/prisma/client'

export type ContactNotification = {
  id: string
  notiType: HiringNotificationType
  createdAt: string
}

type Props = {
  applicationId: string
  phone: string | null
  name: string | null
  postingTitle: string | null
  positionName: string | null
  notifications: ContactNotification[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 연락하기 — 문자 / 전화 / 상태 안내 링크 세 방식을 한 팝업에서.
export function ContactDialog({
  applicationId,
  phone,
  name,
  postingTitle,
  positionName,
  notifications,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const digits = normalizeSmsPhone(phone)
  const noPhone = !phone

  async function copyPhone() {
    if (!phone) return
    try {
      await navigator.clipboard.writeText(phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('복사하지 못했습니다')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 휴대폰에서 키보드가 먼저 올라와 버튼을 가리지 않도록 자동 포커스를 끈다 */}
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>연락하기</DialogTitle>
          <DialogDescription>지원자에게 연락할 방법을 고르세요.</DialogDescription>
        </DialogHeader>
        {noPhone && (
          <p className="text-sm text-muted-foreground">
            연락처가 없어 문자·전화를 사용할 수 없습니다. 상태 안내 링크만 만들 수 있습니다.
          </p>
        )}
        <Tabs defaultValue={noPhone ? 'link' : 'sms'}>
          <TabsList className="w-full">
            <TabsTrigger value="sms" disabled={noPhone}>
              문자
            </TabsTrigger>
            <TabsTrigger value="tel" disabled={noPhone}>
              전화
            </TabsTrigger>
            <TabsTrigger value="link">상태 안내 링크</TabsTrigger>
          </TabsList>
          <TabsContent value="sms" forceMount className="pt-3 data-[state=inactive]:hidden">
            <SmsComposer
              phone={phone}
              name={name}
              postingTitle={postingTitle}
              positionName={positionName}
            />
          </TabsContent>
          <TabsContent
            value="tel"
            forceMount
            className="space-y-3 pt-3 data-[state=inactive]:hidden"
          >
            <p className="text-sm">
              <span className="text-muted-foreground">받는 사람 </span>
              <span className="font-medium">
                {name ?? '(이름 없음)'} {phone}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {digits ? (
                <Button size="sm" asChild>
                  <a href={`tel:${digits}`}>
                    <Phone className="mr-1 size-4" />
                    전화 걸기
                  </a>
                </Button>
              ) : (
                <Button size="sm" disabled>
                  <Phone className="mr-1 size-4" />
                  전화 걸기
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyPhone}>
                {copied ? <Check className="mr-1 size-4" /> : <Copy className="mr-1 size-4" />}
                번호 복사
              </Button>
            </div>
          </TabsContent>
          <TabsContent
            value="link"
            forceMount
            className="space-y-4 pt-3 data-[state=inactive]:hidden"
          >
            <StatusLinkPanel
              applicationId={applicationId}
              name={name}
              postingTitle={postingTitle}
              positionName={positionName}
              onCreated={() => router.refresh()}
            />
            {notifications.length > 0 && (
              <div className="space-y-2 border-t pt-3">
                <h3 className="text-xs font-semibold">알림 발송 이력</h3>
                <ul className="space-y-1.5 text-xs">
                  {notifications.map((n) => (
                    <li key={n.id} className="flex items-center justify-between gap-2">
                      <span className="font-medium">{NOTIFICATION_LABELS[n.notiType]}</span>
                      <span className="text-muted-foreground">
                        {new Date(n.createdAt).toLocaleDateString('ko-KR', {
                          timeZone: 'Asia/Seoul',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
