'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/application-shared'
import { APPLICATION_STAGES, PROCESS_STAGES } from '@/lib/validations/hiring-applicants'
import type { HiringApplicationStage, HiringProcessStage } from '@/generated/prisma/client'
import { StageBadge, ProcessStageBadge } from '@/components/hiring-applicants/badges'

type Props = {
  applicationId: string
  stage: HiringApplicationStage
  hiringStage: HiringProcessStage
}

// 상태(결과·단계) 변경 — PII 미포함. id 만 받는다.
export function StageControls({ applicationId, stage, hiringStage }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [refreshing, startTransition] = useTransition()
  const inFlight = useRef(false)

  async function patch(data: { stage?: HiringApplicationStage; hiringStage?: HiringProcessStage }) {
    if (inFlight.current || refreshing) return
    inFlight.current = true
    const key = data.stage ?? data.hiringStage ?? ''
    setLoading(key)
    try {
      const res = await fetch(`/api/hiring-applicants/applications/${applicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.message ?? '변경 실패')
      }
      toast.success('상태를 변경했습니다')
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
    } finally {
      inFlight.current = false
      setLoading(null)
    }
  }

  return (
    <div className="space-y-4" aria-busy={loading !== null || refreshing}>
      {refreshing && (
        <p role="status" className="text-xs text-muted-foreground">
          변경된 상태를 불러오는 중...
        </p>
      )}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>채용 단계</span>
          <ProcessStageBadge stage={hiringStage} />
        </div>
        <div className="flex flex-wrap gap-2">
          {PROCESS_STAGES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === hiringStage ? 'default' : 'outline'}
              disabled={loading !== null || refreshing || s === hiringStage}
              onClick={() => patch({ hiringStage: s })}
            >
              {loading === s && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {PROCESS_STAGE_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>결과</span>
          <StageBadge stage={stage} />
        </div>
        <div className="flex flex-wrap gap-2">
          {APPLICATION_STAGES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={s === stage ? 'default' : 'outline'}
              disabled={loading !== null || refreshing || s === stage}
              onClick={() => patch({ stage: s })}
            >
              {loading === s && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {STAGE_LABELS[s]}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}
