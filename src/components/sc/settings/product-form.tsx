'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CustomFieldsEditor, type CustomField } from '@/components/sc/shared/custom-fields-editor'
import { SALES_CONTENT_PRODUCTS_PATH } from '@/lib/deck-routes'

type Mode = 'create' | 'edit'

export type ProductFormState = {
  name: string
  oneLinerPitch: string
  customFields: CustomField[]
  isActive: boolean
}

type Props = {
  mode: Mode
  productId?: string
  initial?: Partial<ProductFormState>
  // 다이얼로그 안에서 쓸 때 주입한다. 미전달이면 종전대로 목록 페이지로 이동한다.
  onSaved?: (product: { id: string }) => void
  onCancel?: () => void
}

const EMPTY: ProductFormState = {
  name: '',
  oneLinerPitch: '',
  customFields: [],
  isActive: true,
}

export function ProductForm({ mode, productId, initial, onSaved, onCancel }: Props) {
  const router = useRouter()
  const [state, setState] = useState<ProductFormState>({ ...EMPTY, ...initial })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  // 저장·삭제 후 화면 전환. 다이얼로그 모드면 콜백에 맡기고 페이지 이동을 하지 않는다.
  function leave(id?: string) {
    if (onSaved) {
      onSaved({ id: id ?? '' })
      return
    }
    router.push(SALES_CONTENT_PRODUCTS_PATH)
    router.refresh()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const cleanCustomFields = state.customFields.filter((f) => f.key.trim())
      const body = {
        name: state.name,
        oneLinerPitch: state.oneLinerPitch || undefined,
        customFields: cleanCustomFields.length ? cleanCustomFields : undefined,
        isActive: state.isActive,
      }

      const url = mode === 'create' ? '/api/sc/products' : `/api/sc/products/${productId}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({ message: '저장 실패' }))
        throw new Error(json.message || '저장 실패')
      }
      const saved = (await res.json().catch(() => null)) as { product?: { id: string } } | null
      leave(saved?.product?.id ?? productId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!productId) return
    if (!confirm('정말로 이 상품을 삭제하시겠습니까?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sc/products/${productId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('삭제 실패')
      leave(productId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="name">상품명 *</Label>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => update('name', e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="oneLinerPitch">한 줄 소개</Label>
            <Input
              id="oneLinerPitch"
              value={state.oneLinerPitch}
              onChange={(e) => update('oneLinerPitch', e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="isActive"
              checked={state.isActive}
              onCheckedChange={(checked) => update('isActive', checked)}
            />
            <Label htmlFor="isActive" className="cursor-pointer">
              활성
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">커스텀 필드</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            AI 아이데이션에 추가로 전달할 상품 속성을 자유롭게 정의하세요.
          </p>
          <CustomFieldsEditor
            value={state.customFields}
            onChange={(v) => update('customFields', v)}
          />
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          {mode === 'edit' && (
            <Button type="button" variant="destructive" onClick={onDelete} disabled={submitting}>
              삭제
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => (onCancel ? onCancel() : router.push(SALES_CONTENT_PRODUCTS_PATH))}
            disabled={submitting}
          >
            취소
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </form>
  )
}
