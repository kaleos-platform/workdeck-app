'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type MailSettings = { notificationEnabled: boolean; applicantReceiptEmail: boolean }

const ITEMS: Array<{ key: keyof MailSettings; label: string; description: string }> = [
  {
    key: 'applicantReceiptEmail',
    label: '지원 접수 메일 보내기',
    description:
      '지원자가 이메일을 입력하면 접수 완료 메일(공고명·접수 시각)을 보냅니다. 회신은 공고 담당자에게 전달됩니다.',
  },
  {
    key: 'notificationEnabled',
    label: '새 지원자 일일 요약 메일',
    description:
      '매일 오전 9시, 전날 새 지원자 수를 공고 담당자에게 메일로 보냅니다. 지원자 개인정보는 담지 않습니다.',
  },
]

// 공고 메일 알림 토글 — 발행 후에도 바꿀 수 있다(모집 조건 잠금과 무관).
export function PostingMailSettings({
  postingId,
  initial,
}: {
  postingId: string
  initial: MailSettings
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle(key: keyof MailSettings, checked: boolean) {
    const prev = value
    setValue({ ...value, [key]: checked })
    setSaving(true)
    try {
      const res = await fetch(`/api/hiring-posts/postings/${postingId}/mail-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: checked }),
      })
      if (!res.ok) throw new Error()
      setValue(await res.json())
    } catch {
      setValue(prev)
      toast.error('메일 알림 설정을 저장하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {ITEMS.map((item) => (
        <div
          key={item.key}
          className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
        >
          <div className="space-y-0.5">
            <Label htmlFor={`mail-${item.key}`}>{item.label}</Label>
            <p className="text-xs text-muted-foreground">{item.description}</p>
          </div>
          <Switch
            id={`mail-${item.key}`}
            checked={value[item.key]}
            disabled={saving}
            onCheckedChange={(checked) => void toggle(item.key, checked)}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        공고 담당자는 공고 작성자입니다. 작성자가 워크스페이스를 떠났다면 소유자·관리자가 받습니다.
      </p>
    </div>
  )
}
