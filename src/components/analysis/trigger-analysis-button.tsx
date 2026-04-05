'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

type TriggerAnalysisButtonProps = {
  from: string
  to: string
  onSuccess: () => void
}

export function TriggerAnalysisButton({
  from,
  to,
  onSuccess,
}: TriggerAnalysisButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleTrigger() {
    setLoading(true)
    try {
      const res = await fetch('/api/analysis/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
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
