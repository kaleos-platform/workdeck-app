'use client'

import { useImperativeHandle, useState, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AutoSaveIndicator } from './autosave-indicator'
import { useQueuedSave, type SaveHandle } from './use-queued-save'

type FormSettingsValue = {
  closingDate: string // 'YYYY-MM-DD' 또는 ''
  notificationEnabled: boolean
}

type Props = {
  ref?: Ref<SaveHandle>
  postingId: string
  value: FormSettingsValue
  onChange: (patch: Partial<FormSettingsValue>) => void
}

// 로컬(KST) 기준 오늘 'YYYY-MM-DD'
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 지원서 폼 설정 섹션 — 마감일 + 지원 알림. 지원서 폼 제작 스텝에 배치.
export function StepFormSettings({ ref, postingId, value, onChange }: Props) {
  const router = useRouter()
  const [dateError, setDateError] = useState<string | null>(null)
  const initialDate = useState(value.closingDate)[0]
  const saver = useQueuedSave(value, async (next) => {
    const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        closingDate: next.closingDate || null,
        notificationEnabled: next.notificationEnabled,
      }),
    })
    if (!res.ok) throw new Error('마감일·알림 설정 저장에 실패했습니다')
    router.refresh()
  })

  function flush(next = value): Promise<void> {
    // 기존 마감 공고의 날짜는 유지할 수 있지만 새로 과거 날짜를 입력할 수는 없다.
    if (next.closingDate !== initialDate && next.closingDate && next.closingDate < todayStr()) {
      const message = '오늘 이전 날짜는 선택할 수 없습니다'
      setDateError(message)
      return Promise.reject(new Error(message))
    }
    return saver.flush(next)
  }
  useImperativeHandle(ref, () => ({ flush }))

  function doSave(patch: Partial<FormSettingsValue>) {
    void flush({ ...value, ...patch }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '설정 저장에 실패했습니다')
    })
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    onChange({ closingDate: next })
    setDateError(next && next < todayStr() ? '오늘 이전 날짜는 선택할 수 없습니다' : null)
  }

  function handleDateBlur() {
    // 과거 날짜는 저장하지 않음 (에러 표시 유지)
    if (value.closingDate && value.closingDate < todayStr()) return
    doSave({ closingDate: value.closingDate })
  }

  function handleNotifChange(v: boolean) {
    onChange({ notificationEnabled: v })
    doSave({ notificationEnabled: v })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="closingDate">지원서 마감일</Label>
        <Input
          id="closingDate"
          type="date"
          value={value.closingDate}
          min={todayStr()}
          onChange={handleDateChange}
          onBlur={handleDateBlur}
          className="w-48"
        />
        {dateError && <p className="text-xs text-destructive">{dateError}</p>}
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
          onCheckedChange={handleNotifChange}
        />
      </div>

      <div className="flex justify-end">
        <AutoSaveIndicator status={saver.status} />
      </div>
    </div>
  )
}
