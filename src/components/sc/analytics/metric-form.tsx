'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Props = {
  deploymentId: string
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export function MetricForm({ deploymentId }: Props) {
  const router = useRouter()
  const [date, setDate] = useState(todayISO())
  const [impressions, setImpressions] = useState('')
  const [views, setViews] = useState('')
  const [likes, setLikes] = useState('')
  const [comments, setComments] = useState('')
  const [shares, setShares] = useState('')
  const [externalClicks, setExternalClicks] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setSubmitting(true)
    const body = {
      date,
      source: 'MANUAL' as const,
      impressions: toNum(impressions),
      views: toNum(views),
      likes: toNum(likes),
      comments: toNum(comments),
      shares: toNum(shares),
      externalClicks: toNum(externalClicks),
    }
    try {
      const res = await fetch(`/api/sc/metrics/${deploymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '저장 실패')
        return
      }
      setMessage(`${date} 지표가 저장되었습니다.`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">지표 수동 입력</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="date">일자</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="노출" value={impressions} onChange={setImpressions} />
            <Field label="조회" value={views} onChange={setViews} />
            <Field label="좋아요" value={likes} onChange={setLikes} />
            <Field label="댓글" value={comments} onChange={setComments} />
            <Field label="공유" value={shares} onChange={setShares} />
            <Field label="외부 클릭" value={externalClicks} onChange={setExternalClicks} />
          </div>

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

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? '저장 중…' : '저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function Field(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{props.label}</Label>
      <Input
        type="number"
        min={0}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  )
}

function toNum(s: string): number | null {
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
