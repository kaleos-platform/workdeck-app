'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'

type Product = { id: string; name: string }

interface IdeationFormProps {
  products: Product[]
  onSuccess: () => void
}

export function IdeationForm({ products, onSuccess }: IdeationFormProps) {
  const [productId, setProductId] = useState<string>('')
  const [userPromptInput, setUserPromptInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/bo/ideations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          userPromptInput: userPromptInput.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? '소구점 발굴에 실패했습니다')
      }

      setUserPromptInput('')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }

  const noProducts = products.length === 0

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="bo-product-select">분석 대상 제품</Label>
        {noProducts ? (
          <p className="text-sm text-muted-foreground">제품을 먼저 등록해 주세요.</p>
        ) : (
          <Select value={productId} onValueChange={setProductId} disabled={loading}>
            <SelectTrigger id="bo-product-select" className="w-full">
              <SelectValue placeholder="제품을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="bo-user-prompt">추가 지시 (선택)</Label>
        <Textarea
          id="bo-user-prompt"
          placeholder="특정 타겟, 강조하고 싶은 기능, 방향성 등을 자유롭게 입력하세요"
          value={userPromptInput}
          onChange={(e) => setUserPromptInput(e.target.value)}
          rows={3}
          disabled={loading || noProducts}
          maxLength={2000}
        />
        <p className="text-right text-xs text-muted-foreground">{userPromptInput.length}/2000</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={!productId || loading || noProducts} className="w-full">
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            소구점 발굴 중...
          </>
        ) : (
          '소구점 발굴 실행'
        )}
      </Button>
    </form>
  )
}
