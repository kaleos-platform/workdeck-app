'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StringArrayField } from './string-array-field'
import { SALES_CONTENT_PRODUCTS_PATH } from '@/lib/deck-routes'

type Mode = 'create' | 'edit'

type ProductFormState = {
  name: string
  slug: string
  oneLinerPitch: string
  valueProposition: string
  targetCustomers: string
  keyFeatures: string[]
  differentiators: string[]
  painPointsAddressed: string[]
  pricingModel: string
  priceMin: string
  priceMax: string
  ctaTargetUrl: string
  isActive: boolean
}

type Props = {
  mode: Mode
  productId?: string
  initial?: Partial<ProductFormState>
}

const EMPTY: ProductFormState = {
  name: '',
  slug: '',
  oneLinerPitch: '',
  valueProposition: '',
  targetCustomers: '',
  keyFeatures: [],
  differentiators: [],
  painPointsAddressed: [],
  pricingModel: '',
  priceMin: '',
  priceMax: '',
  ctaTargetUrl: '',
  isActive: true,
}

export function ProductForm({ mode, productId, initial }: Props) {
  const router = useRouter()
  const [state, setState] = useState<ProductFormState>({ ...EMPTY, ...initial })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function update<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        name: state.name,
        slug: state.slug,
        oneLinerPitch: state.oneLinerPitch || undefined,
        valueProposition: state.valueProposition || undefined,
        targetCustomers: state.targetCustomers || undefined,
        keyFeatures: state.keyFeatures.length ? state.keyFeatures : undefined,
        differentiators: state.differentiators.length ? state.differentiators : undefined,
        painPointsAddressed: state.painPointsAddressed.length
          ? state.painPointsAddressed
          : undefined,
        pricingModel: state.pricingModel || undefined,
        priceMin: state.priceMin || undefined,
        priceMax: state.priceMax || undefined,
        ctaTargetUrl: state.ctaTargetUrl || undefined,
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
      router.push(SALES_CONTENT_PRODUCTS_PATH)
      router.refresh()
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
      router.push(SALES_CONTENT_PRODUCTS_PATH)
      router.refresh()
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
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug *</Label>
            <Input
              id="slug"
              value={state.slug}
              onChange={(e) => update('slug', e.target.value)}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="my-product"
            />
            <p className="text-xs text-muted-foreground">영문 소문자·숫자·하이픈만 허용</p>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch
              id="isActive"
              checked={state.isActive}
              onCheckedChange={(checked) => update('isActive', checked)}
            />
            <Label htmlFor="isActive" className="cursor-pointer">
              활성
            </Label>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">마케팅 메시지</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="valueProposition">핵심 가치 제안</Label>
            <Textarea
              id="valueProposition"
              value={state.valueProposition}
              onChange={(e) => update('valueProposition', e.target.value)}
              rows={4}
              placeholder="이 상품이 고객에게 제공하는 가치를 자유롭게 서술하세요"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="targetCustomers">타겟 고객</Label>
            <Textarea
              id="targetCustomers"
              value={state.targetCustomers}
              onChange={(e) => update('targetCustomers', e.target.value)}
              rows={3}
            />
          </div>
          <StringArrayField
            id="keyFeatures"
            label="핵심 기능·특징"
            value={state.keyFeatures}
            onChange={(v) => update('keyFeatures', v)}
          />
          <StringArrayField
            id="differentiators"
            label="차별화 요소"
            value={state.differentiators}
            onChange={(v) => update('differentiators', v)}
          />
          <StringArrayField
            id="painPointsAddressed"
            label="해결하는 고통 포인트"
            value={state.painPointsAddressed}
            onChange={(v) => update('painPointsAddressed', v)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">가격·CTA</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="pricingModel">가격 모델 설명</Label>
            <Textarea
              id="pricingModel"
              value={state.pricingModel}
              onChange={(e) => update('pricingModel', e.target.value)}
              rows={2}
              placeholder="예: 연간 구독, 사용량 기반, 맞춤 견적"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priceMin">최저 가격 (원)</Label>
            <Input
              id="priceMin"
              type="number"
              min="0"
              value={state.priceMin}
              onChange={(e) => update('priceMin', e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="priceMax">최고 가격 (원)</Label>
            <Input
              id="priceMax"
              type="number"
              min="0"
              value={state.priceMax}
              onChange={(e) => update('priceMax', e.target.value)}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="ctaTargetUrl">기본 CTA 링크</Label>
            <Input
              id="ctaTargetUrl"
              type="url"
              value={state.ctaTargetUrl}
              onChange={(e) => update('ctaTargetUrl', e.target.value)}
              placeholder="https://"
            />
            <p className="text-xs text-muted-foreground">
              콘텐츠 생성 시 기본값으로 사용되며, 콘텐츠별로 오버라이드 가능합니다.
            </p>
          </div>
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
            onClick={() => router.push(SALES_CONTENT_PRODUCTS_PATH)}
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
