'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SALES_CONTENT_IDEATION_PATH } from '@/lib/deck-routes'

type Option = { id: string; name: string; slug: string }

type Props = {
  products: Option[]
  personas: Option[]
  brandConfigured: boolean
}

const NONE_VALUE = '__none'

export function IdeationForm({ products, personas, brandConfigured }: Props) {
  const router = useRouter()
  const [productId, setProductId] = useState<string>(NONE_VALUE)
  const [personaId, setPersonaId] = useState<string>(NONE_VALUE)
  const [userPromptInput, setUserPromptInput] = useState('')
  const [count, setCount] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missingContext = productId === NONE_VALUE && personaId === NONE_VALUE && !brandConfigured

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (missingContext) {
      setError('상품·페르소나·브랜드 프로필 중 최소 하나는 설정되어 있어야 합니다.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/sc/ideations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'ai',
          productId: productId === NONE_VALUE ? null : productId,
          personaId: personaId === NONE_VALUE ? null : personaId,
          userPromptInput: userPromptInput.trim() || undefined,
          count,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message ?? '글감 생성에 실패했습니다')
        return
      }
      router.push(`${SALES_CONTENT_IDEATION_PATH}/${data.ideationId}`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">새 글감 생성</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>판매 상품</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="상품 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안 함</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>타겟 페르소나</Label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger>
                  <SelectValue placeholder="페르소나 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>선택 안 함</SelectItem>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="userPromptInput">추가 지시 (선택)</Label>
            <Textarea
              id="userPromptInput"
              value={userPromptInput}
              onChange={(e) => setUserPromptInput(e.target.value)}
              placeholder="예: 최근 고객 이탈 방지 사례를 중심으로 엮어 주세요"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="count">생성 개수</Label>
            <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
              <SelectTrigger id="count" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}개
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {missingContext && (
            <p className="text-xs text-muted-foreground">
              상품·페르소나·브랜드 프로필 중 최소 하나를 먼저 설정하면 결과 품질이 올라갑니다.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? '생성 중…' : '글감 생성'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
