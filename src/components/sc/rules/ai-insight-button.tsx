'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

type RunResult = {
  createdRules: number
  skippedReason?: 'NO_DATA' | 'NO_PROPOSALS'
  providerName?: string
  bucketCount: number
}

export function AiInsightButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (loading) return
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      const res = await fetch('/api/sc/insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sinceDays: 30, maxProposals: 5 }),
      })
      const data = (await res.json().catch(() => ({}))) as RunResult & { message?: string }
      if (!res.ok) {
        setError(data.message ?? 'AI 제안 생성 실패')
        return
      }

      if (data.skippedReason === 'NO_DATA') {
        setMessage('최근 30일 내 성과 데이터가 없습니다. 배포 후 수집을 먼저 진행하세요.')
      } else if (data.skippedReason === 'NO_PROPOSALS') {
        setMessage('AI가 새 규칙을 제안하지 않았습니다 (기존 규칙과 중복 가능성).')
      } else {
        setMessage(
          `AI가 ${data.createdRules}개의 규칙 후보를 제안했습니다. 아래 PROPOSED 규칙을 확인하고 활성화하세요. (분석: ${data.bucketCount} 버킷${data.providerName ? `, ${data.providerName}` : ''})`
        )
      }
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 제안 생성 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || pending}
          onClick={onClick}
        >
          <Sparkles className="h-4 w-4" />
          {loading ? '분석 중…' : 'AI에게 개선 규칙 제안 받기'}
        </Button>
        <p className="text-xs text-muted-foreground">
          최근 30일 배포 성과를 분석해 PROPOSED 규칙 후보를 생성합니다.
        </p>
      </div>
      {message && (
        <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
