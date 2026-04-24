'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Kind = 'COOKIE' | 'OAUTH' | 'API_KEY'

type Props = {
  channelId: string
}

export function CredentialForm({ channelId }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('COOKIE')
  const [payloadText, setPayloadText] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)

    let payload: Record<string, unknown>
    try {
      const trimmed = payloadText.trim()
      if (kind === 'API_KEY') {
        // API_KEY: 한 줄 입력 허용 - 내부 {key} 로 wrap
        payload = trimmed.startsWith('{')
          ? (JSON.parse(trimmed) as Record<string, unknown>)
          : { key: trimmed }
      } else {
        payload = JSON.parse(trimmed) as Record<string, unknown>
      }
    } catch (err) {
      setError(`페이로드 파싱 실패: ${err instanceof Error ? err.message : ''}`)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/sc/channels/${channelId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          payload,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '저장 실패')
        return
      }
      setMessage('자격증명이 저장되었습니다. 복호화는 워커 프로세스에서만 수행됩니다.')
      setPayloadText('')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">자격증명 추가/교체</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>종류</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COOKIE">쿠키 (Playwright storageState)</SelectItem>
                <SelectItem value="OAUTH">OAuth 토큰</SelectItem>
                <SelectItem value="API_KEY">API Key</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payload">
              {kind === 'COOKIE' && 'storageState JSON'}
              {kind === 'OAUTH' && 'OAuth 페이로드 JSON — {"accessToken":"..."}'}
              {kind === 'API_KEY' && 'API Key (문자열 또는 JSON)'}
            </Label>
            <Textarea
              id="payload"
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiresAt">만료 (선택)</Label>
            <Input
              id="expiresAt"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
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
              {submitting ? '저장 중…' : '자격증명 저장'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
