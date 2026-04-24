'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  deploymentId: string
  status: string
  contentStatus: string
}

export function ExecuteDeploymentButton({ deploymentId, status, contentStatus }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const canExecute =
    (status === 'SCHEDULED' || status === 'FAILED') &&
    (contentStatus === 'APPROVED' || contentStatus === 'SCHEDULED')

  async function onClick() {
    setError(null)
    setMessage(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sc/deployments/${deploymentId}/execute`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '실행 요청 실패')
        return
      }
      setMessage(`PUBLISH 작업이 큐에 등록되었습니다 (job ${data.jobId}). 워커가 처리합니다.`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">배포 실행</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!canExecute && (
          <p className="text-xs text-muted-foreground">
            콘텐츠가 APPROVED/SCHEDULED 이고 배포가 SCHEDULED/FAILED 일 때만 실행할 수 있습니다.
            (현재: 콘텐츠 {contentStatus} / 배포 {status})
          </p>
        )}
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {message && !error && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
            {message}
          </p>
        )}
        <Button onClick={onClick} disabled={!canExecute || submitting}>
          {submitting ? '등록 중…' : '지금 배포 실행'}
        </Button>
      </CardContent>
    </Card>
  )
}
