'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

type FormSettingsValue = {
  closingDate: string // 'YYYY-MM-DD' 또는 ''
  notificationEnabled: boolean
}

type Props = {
  postingId: string
  value: FormSettingsValue
  onChange: (patch: Partial<FormSettingsValue>) => void
}

// 지원서 폼 설정 섹션 — 마감일 + 지원 알림. 지원서 폼 제작 스텝에 배치.
export function StepFormSettings({ postingId, value, onChange }: Props) {
  const router = useRouter()
  const [saving, startSave] = useTransition()

  function handleSave() {
    startSave(async () => {
      try {
        const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            closingDate: value.closingDate || null,
            notificationEnabled: value.notificationEnabled,
          }),
        })
        if (!res.ok) throw new Error('저장에 실패했습니다')
        toast.success('지원서 설정을 저장했습니다')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장에 실패했습니다')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="closingDate">지원서 마감일</Label>
        <Input
          id="closingDate"
          type="date"
          value={value.closingDate}
          onChange={(e) => onChange({ closingDate: e.target.value })}
          className="w-48"
        />
        <p className="text-xs text-muted-foreground">
          비워두면 마감일 없이 상시 모집으로 운영됩니다.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="notif">지원 알림</Label>
          <p className="text-xs text-muted-foreground">
            새 지원 발생 시 담당자에게 알림을 보냅니다.
          </p>
        </div>
        <Switch
          id="notif"
          checked={value.notificationEnabled}
          onCheckedChange={(v) => onChange({ notificationEnabled: v })}
        />
      </div>

      <Button size="sm" onClick={handleSave} disabled={saving}>
        지원서 설정 저장
      </Button>
    </div>
  )
}
