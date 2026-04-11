'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'

type TriggerAnalysisButtonProps = {
  from: string
  to: string
  onSuccess: () => void
  activeReportId?: string | null
}

export function TriggerAnalysisButton({
  from,
  to,
  onSuccess,
  activeReportId,
}: TriggerAnalysisButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleTrigger() {
    setLoading(true)
    try {
      // 분석 기간: 항상 최근 30일
      const toDate = new Date()
      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - 30)
      const analysisFrom = fromDate.toISOString().slice(0, 10)
      const analysisTo = toDate.toISOString().slice(0, 10)

      const res = await fetch('/api/analysis/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: analysisFrom, to: analysisTo }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string
        }
        throw new Error(data.message || '분석 요청에 실패했습니다')
      }

      toast.success('분석이 시작되었습니다')
      onSuccess()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : '분석 요청에 실패했습니다'
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleCancel() {
    if (!activeReportId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/analysis/reports/${activeReportId}`, {
        method: 'PATCH',
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          message?: string
        }
        throw new Error(data.message || '분석 종료에 실패했습니다')
      }

      toast.success('분석이 종료되었습니다')
      onSuccess()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : '분석 종료에 실패했습니다'
      )
    } finally {
      setLoading(false)
    }
  }

  // 진행 중인 분석이 있으면 종료 버튼 표시
  if (activeReportId) {
    return (
      <Button
        variant="destructive"
        onClick={handleCancel}
        disabled={loading}
        className="gap-2"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Square className="h-4 w-4" />
        )}
        {loading ? '종료 중...' : '분석 종료'}
      </Button>
    )
  }

  return (
    <Button onClick={handleTrigger} disabled={loading} className="gap-2">
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      {loading ? '분석 중...' : '분석 실행'}
    </Button>
  )
}
