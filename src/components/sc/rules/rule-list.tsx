'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Rule = {
  id: string
  scope: 'WORKSPACE' | 'PRODUCT' | 'PERSONA' | 'CHANNEL' | 'COMBINATION'
  source: 'USER' | 'AI'
  status: 'PROPOSED' | 'ACTIVE' | 'ARCHIVED'
  title: string
  body: string
  weight: number
}

type Props = { rules: Rule[] }

export function RuleList({ rules }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function changeStatus(id: string, status: 'ACTIVE' | 'ARCHIVED') {
    setError(null)
    const res = await fetch(`/api/sc/improvement-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data?.message ?? '상태 변경 실패')
      return
    }
    startTransition(() => router.refresh())
  }

  async function remove(id: string) {
    if (!window.confirm('이 규칙을 삭제하시겠습니까?')) return
    const res = await fetch(`/api/sc/improvement-rules/${id}`, { method: 'DELETE' })
    if (res.ok) startTransition(() => router.refresh())
  }

  if (rules.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          아직 등록된 개선 규칙이 없습니다. 아래 폼으로 첫 규칙을 추가하세요.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {rules.map((r) => (
        <Card key={r.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      r.status === 'ACTIVE'
                        ? 'default'
                        : r.status === 'PROPOSED'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {r.status}
                  </Badge>
                  <Badge variant="outline">{r.scope}</Badge>
                  <Badge variant="outline">{r.source}</Badge>
                  <span className="text-xs text-muted-foreground">w={r.weight}</span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold">{r.title}</h3>
                <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">{r.body}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {r.status !== 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => changeStatus(r.id, 'ACTIVE')}
                >
                  활성화
                </Button>
              )}
              {r.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => changeStatus(r.id, 'ARCHIVED')}
                >
                  보관
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(r.id)}>
                삭제
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
