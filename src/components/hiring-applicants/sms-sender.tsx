'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { RECRUITING_MESSAGES_PATH } from '@/lib/deck-routes'
import { fillMessage, normalizeSmsPhone } from '@/lib/hiring/message-template'

type Template = { id: string; title: string; content: string }

type Props = {
  phone: string | null
  name: string | null
  postingTitle: string | null
  positionName: string | null
}

// 문자 작성 본문(트리거·다이얼로그 없음) — 마운트되면 템플릿을 불러온다. 서버 전송 없음.
export function SmsComposer({ phone, name, postingTitle, positionName }: Props) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)
  const digits = normalizeSmsPhone(phone)
  // 다이얼로그가 열린 뒤(클라이언트)에만 마운트되므로 hydration 불일치 없음
  const touch =
    typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)

  useEffect(() => {
    fetch('/api/hiring-applicants/message-templates')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setTemplates(d.items ?? []))
      .catch(() => setTemplates([]))
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('복사하지 못했습니다')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="text-muted-foreground">받는 사람 </span>
        <span className="font-medium">
          {name ?? '(이름 없음)'} {phone ?? '(연락처 없음)'}
        </span>
      </p>

      {templates && templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          저장된 메시지가 없습니다.{' '}
          <Link href={RECRUITING_MESSAGES_PATH} className="underline">
            설정 &gt; 메시지 관리
          </Link>
          에서 추가하세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {(templates ?? []).map((t) => (
            <Button
              key={t.id}
              size="xs"
              variant="secondary"
              onClick={() => setBody(fillMessage(t.content, { name, postingTitle, positionName }))}
            >
              {t.title}
            </Button>
          ))}
        </div>
      )}

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={7}
        aria-label="문자 내용"
        placeholder="위에서 메시지를 선택하거나 직접 입력하세요"
      />

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" onClick={copy} disabled={!body}>
          {copied ? <Check className="mr-1 size-4" /> : <Copy className="mr-1 size-4" />}
          메시지 복사
        </Button>
        {digits && touch && (
          <Button size="sm" asChild>
            <a href={`sms:${digits}?&body=${encodeURIComponent(body)}`}>문자 앱 열기</a>
          </Button>
        )}
      </div>
    </div>
  )
}

// 문자 보내기 — 자주 쓰는 메시지를 지원자 정보로 채워 문자 앱(sms:)으로 넘기거나 복사.
export function SmsSender(props: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!props.phone}>
          <MessageSquare className="mr-1 size-3.5" />
          문자 보내기
        </Button>
      </DialogTrigger>
      {/* 휴대폰에서 키보드가 먼저 올라와 메시지 버튼을 가리지 않도록 자동 포커스를 끈다 */}
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>문자 보내기</DialogTitle>
          <DialogDescription>
            메시지를 고르고 내용을 확인한 뒤 문자 앱으로 보내거나 복사하세요.
          </DialogDescription>
        </DialogHeader>
        <SmsComposer {...props} />
      </DialogContent>
    </Dialog>
  )
}
