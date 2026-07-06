'use client'

import { useEffect, useState } from 'react'
import { Loader2, Send, Copy, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NOTIFICATION_LABELS } from '@/lib/hiring/application-shared'
import { NOTIFICATION_TYPES } from '@/lib/validations/hiring-applicants'
import type { HiringNotificationType } from '@/generated/prisma/client'

type Template = { id: string; title: string; content: string }

type Props = { applicationId: string }

// 상태 알림 발송 — 공개열람 URL 생성(수동 복사). SMS/알림톡 미연동.
export function NotificationSender({ applicationId }: Props) {
  const [open, setOpen] = useState(false)
  const [notiType, setNotiType] = useState<HiringNotificationType>('INTERVIEW')
  const [detail, setDetail] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [sending, setSending] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch('/api/hiring-applicants/message-templates')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setTemplates(d.items ?? []))
      .catch(() => setTemplates([]))
  }, [open])

  async function send() {
    setSending(true)
    try {
      const res = await fetch(
        `/api/hiring-applicants/applications/${applicationId}/notifications`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notiType, detailMessage: detail || undefined }),
        }
      )
      if (!res.ok) throw new Error('발송 실패')
      const { statusUrl } = (await res.json()) as { statusUrl: string }
      setResultUrl(`${window.location.origin}${statusUrl}`)
    } catch {
      toast.error('알림 생성에 실패했습니다')
    } finally {
      setSending(false)
    }
  }

  async function copy() {
    if (!resultUrl) return
    await navigator.clipboard.writeText(resultUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function reset() {
    setResultUrl(null)
    setDetail('')
    setCopied(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Send className="mr-1 size-3.5" />
          상태 알림
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>상태 알림 발송</DialogTitle>
          <DialogDescription>
            공개 열람 링크를 생성합니다. 생성된 링크를 지원자에게 직접 전달하세요(문자·메신저 등).
          </DialogDescription>
        </DialogHeader>

        {resultUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              아래 링크를 복사해 지원자에게 전달하세요. (30일간 유효)
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={resultUrl} className="text-xs" />
              <Button size="sm" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">알림 종류</label>
              <Select
                value={notiType}
                onValueChange={(v) => setNotiType(v as HiringNotificationType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTIFICATION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {NOTIFICATION_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {templates.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">템플릿 빠른 채우기</label>
                <div className="flex flex-wrap gap-1.5">
                  {templates.map((t) => (
                    <Button
                      key={t.id}
                      size="xs"
                      variant="secondary"
                      onClick={() => setDetail(t.content)}
                    >
                      {t.title}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">상세 메시지</label>
              <Textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={5}
                placeholder="면접 일정·장소 등 안내 내용을 입력하세요"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={send} disabled={sending}>
                {sending && <Loader2 className="mr-1 size-4 animate-spin" />}
                링크 생성
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
