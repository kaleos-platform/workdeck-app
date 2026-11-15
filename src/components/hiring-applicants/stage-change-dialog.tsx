'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/application-shared'
import { APPLICATION_STAGES, PROCESS_STAGES } from '@/lib/validations/hiring-applicants'
import type { HiringApplicationStage, HiringProcessStage } from '@/generated/prisma/client'

type Props = {
  applicationId: string
  stage: HiringApplicationStage
  hiringStage: HiringProcessStage
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Options<T extends string>({
  label,
  values,
  labels,
  value,
  onChange,
  disabled,
}: {
  label: string
  values: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (v: T) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <Button
            key={v}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={v === value}
            disabled={disabled}
            className={cn(v === value && 'border-primary bg-primary/10 text-foreground')}
            onClick={() => onChange(v)}
          >
            {labels[v]}
          </Button>
        ))}
      </div>
    </div>
  )
}

// 모집 단계 변경 — 채용 단계·결과를 각각 고르고 한 번의 PATCH 로 저장. PII 미포함.
export function StageChangeDialog({
  applicationId,
  stage,
  hiringStage,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [nextStage, setNextStage] = useState(stage)
  const [nextHiring, setNextHiring] = useState(hiringStage)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const inFlight = useRef(false)
  const changed = nextStage !== stage || nextHiring !== hiringStage
  const busy = saving || refreshing
  // 팝업이 열린 뒤(클라이언트)에만 평가 — 데스크톱은 Dialog, 모바일은 하단 Sheet
  const desktop = open && (window.matchMedia?.('(min-width: 1024px)').matches ?? true)

  // 열릴 때(또는 서버 값이 바뀌면) 선택을 현재 값으로 되돌린다
  useEffect(() => {
    if (!open) return
    setNextStage(stage)
    setNextHiring(hiringStage)
  }, [open, stage, hiringStage])

  async function save() {
    if (!changed || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage, hiringStage: nextHiring }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '변경 실패')
      }
      toast.success('상태를 변경했습니다')
      onOpenChange(false)
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const body = (
    <div className="space-y-4" aria-busy={busy}>
      <Options
        label="채용 단계"
        values={PROCESS_STAGES}
        labels={PROCESS_STAGE_LABELS}
        value={nextHiring}
        onChange={setNextHiring}
        disabled={busy}
      />
      <Options
        label="결과"
        values={APPLICATION_STAGES}
        labels={STAGE_LABELS}
        value={nextStage}
        onChange={setNextStage}
        disabled={busy}
      />
      {nextStage === 'REJECTED' && stage !== 'REJECTED' && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          불합격으로 변경합니다. 지원자에게 보이는 결과 화면에도 반영될 수 있으니 확인하세요.
        </p>
      )}
    </div>
  )
  const actions = (
    <>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
        취소
      </Button>
      <Button onClick={save} disabled={!changed || busy}>
        {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
        변경
      </Button>
    </>
  )

  if (!desktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>모집 단계 변경</SheetTitle>
            <SheetDescription>채용 단계와 결과를 고른 뒤 변경하세요.</SheetDescription>
          </SheetHeader>
          <div className="px-4">{body}</div>
          <SheetFooter className="flex-row justify-end">{actions}</SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>모집 단계 변경</DialogTitle>
          <DialogDescription>채용 단계와 결과를 고른 뒤 변경하세요.</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
