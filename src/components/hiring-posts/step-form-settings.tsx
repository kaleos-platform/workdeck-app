'use client'

import { useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { defaultClosingDateStr } from '@/lib/hiring/closing-date'
import { AutoSaveIndicator } from './autosave-indicator'
import { useQueuedSave, type SaveHandle } from './use-queued-save'

type FormSettingsValue = {
  closingDate: string // 'YYYY-MM-DD' 또는 ''
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

// 지원서 폼 설정 섹션 — 마감일. 메일 알림은 발행 후에도 바꿀 수 있어 posting-mail-settings 로 분리.
export function StepFormSettings({ ref, postingId, value, onChange }: Props) {
  const router = useRouter()
  const [dateError, setDateError] = useState<string | null>(null)
  const initialDate = useState(value.closingDate)[0]
  // 상시 모집은 빈 날짜가 아니라 명시적 선택이다. 저장된 마감일이 없으면 체크된 상태로 시작한다.
  const [always, setAlways] = useState(!value.closingDate)
  const lastDate = useRef(value.closingDate)
  const saver = useQueuedSave(value, async (next) => {
    const res = await fetch(`/api/hiring-posts/postings/${postingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        closingDate: next.closingDate || null,
      }),
    })
    if (!res.ok) throw new Error('마감일 저장에 실패했습니다')
    router.refresh()
  })

  function flush(next = value, isAlways = always): Promise<void> {
    if (!isAlways && !next.closingDate) {
      const message = '마감일을 선택하거나 상시 모집을 선택하세요'
      setDateError(message)
      return Promise.reject(new Error(message))
    }
    // 기존 마감 공고의 날짜는 유지할 수 있지만 새로 과거 날짜를 입력할 수는 없다.
    if (next.closingDate !== initialDate && next.closingDate && next.closingDate < todayStr()) {
      const message = '오늘 이전 날짜는 선택할 수 없습니다'
      setDateError(message)
      return Promise.reject(new Error(message))
    }
    return saver.flush(next)
  }
  useImperativeHandle(ref, () => ({ flush }))

  function doSave(patch: Partial<FormSettingsValue>, isAlways = always) {
    void flush({ ...value, ...patch }, isAlways).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : '설정 저장에 실패했습니다')
    })
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    if (next) lastDate.current = next
    onChange({ closingDate: next })
    setDateError(next && next < todayStr() ? '오늘 이전 날짜는 선택할 수 없습니다' : null)
  }

  function handleDateBlur() {
    // 과거 날짜는 저장하지 않음 (에러 표시 유지)
    if (value.closingDate && value.closingDate < todayStr()) return
    if (!value.closingDate) {
      setDateError('마감일을 선택하거나 상시 모집을 선택하세요')
      return
    }
    doSave({ closingDate: value.closingDate })
  }

  function handleAlwaysChange(checked: boolean) {
    setAlways(checked)
    setDateError(null)
    if (checked) {
      if (value.closingDate) lastDate.current = value.closingDate
      onChange({ closingDate: '' })
      doSave({ closingDate: '' }, true)
      return
    }
    const restored = lastDate.current || defaultClosingDateStr()
    onChange({ closingDate: restored })
    doSave({ closingDate: restored }, false)
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
          disabled={always}
          onChange={handleDateChange}
          onBlur={handleDateBlur}
          className="w-48"
        />
        {dateError && <p className="text-xs text-destructive">{dateError}</p>}
        <div className="flex items-center gap-2">
          <Checkbox
            id="closingAlways"
            checked={always}
            onCheckedChange={(checked) => handleAlwaysChange(checked === true)}
          />
          <Label htmlFor="closingAlways">상시 모집</Label>
        </div>
        {always && (
          <p className="text-xs text-muted-foreground">
            마감일 없이 직접 마감할 때까지 지원서를 받습니다.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <AutoSaveIndicator status={saver.status} />
      </div>
    </div>
  )
}
