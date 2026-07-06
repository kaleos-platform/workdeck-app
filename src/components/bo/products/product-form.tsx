'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Trash2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { BLOG_OPS_PRODUCTS_PATH } from '@/lib/deck-routes'
import { CrawlButton } from '@/components/bo/products/product-list'

type Mode = 'create' | 'edit'
type CrawlStatus = 'NONE' | 'PENDING' | 'DONE' | 'FAILED'

type CustomField = { key: string; value: string }

type ProductFormState = {
  name: string
  category: 'B2B' | 'B2C' | '기타' | ''
  oneLinerPitch: string
  homepageUrl: string
  targetCustomer: string
  ctaUrl: string
  features: string[]
  customFields: CustomField[]
  isActive: boolean
}

type Props = {
  mode: Mode
  productId?: string
  initial?: Partial<ProductFormState>
  crawlStatus?: CrawlStatus
  crawledAt?: Date | string | null
  crawledText?: string | null
}

const EMPTY: ProductFormState = {
  name: '',
  category: '',
  oneLinerPitch: '',
  homepageUrl: '',
  targetCustomer: '',
  ctaUrl: '',
  features: [],
  customFields: [],
  isActive: true,
}

function crawlStatusBadge(status: CrawlStatus) {
  switch (status) {
    case 'NONE':
      return (
        <Badge variant="secondary" className="text-xs">
          미수집
        </Badge>
      )
    case 'PENDING':
      return (
        <Badge className="border-blue-200 bg-blue-100 text-xs text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          수집 중
        </Badge>
      )
    case 'DONE':
      return (
        <Badge className="border-emerald-200 bg-emerald-100 text-xs text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          수집 완료
        </Badge>
      )
    case 'FAILED':
      return (
        <Badge className="border-red-200 bg-red-100 text-xs text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
          수집 실패
        </Badge>
      )
  }
}

export function ProductForm({
  mode,
  productId,
  initial,
  crawlStatus,
  crawledAt,
  crawledText,
}: Props) {
  const router = useRouter()
  const [state, setState] = useState<ProductFormState>({ ...EMPTY, ...initial })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newFeature, setNewFeature] = useState('')
  const [crawledTextOpen, setCrawledTextOpen] = useState(false)
  const [currentCrawlStatus, setCurrentCrawlStatus] = useState<CrawlStatus>(crawlStatus ?? 'NONE')
  const [currentCrawledAt, setCurrentCrawledAt] = useState<Date | string | null>(crawledAt ?? null)
  const [currentCrawledText] = useState<string | null>(crawledText ?? null)

  function update<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  function addFeature() {
    const trimmed = newFeature.trim()
    if (!trimmed) return
    update('features', [...state.features, trimmed])
    setNewFeature('')
  }

  function removeFeature(i: number) {
    update(
      'features',
      state.features.filter((_, idx) => idx !== i)
    )
  }

  function updateCustomFieldKey(i: number, key: string) {
    const next = state.customFields.map((f, idx) => (idx === i ? { ...f, key } : f))
    update('customFields', next)
  }

  function updateCustomFieldValue(i: number, value: string) {
    const next = state.customFields.map((f, idx) => (idx === i ? { ...f, value } : f))
    update('customFields', next)
  }

  function removeCustomField(i: number) {
    update(
      'customFields',
      state.customFields.filter((_, idx) => idx !== i)
    )
  }

  function addCustomField() {
    update('customFields', [...state.customFields, { key: '', value: '' }])
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        name: state.name,
        category: state.category || undefined,
        oneLinerPitch: state.oneLinerPitch || undefined,
        homepageUrl: state.homepageUrl || undefined,
        targetCustomer: state.targetCustomer || undefined,
        ctaUrl: state.ctaUrl || undefined,
        features: state.features.length ? state.features : undefined,
        customFields: state.customFields.filter((f) => f.key.trim()).length
          ? state.customFields.filter((f) => f.key.trim())
          : undefined,
        isActive: state.isActive,
      }

      const url = mode === 'create' ? '/api/bo/products' : `/api/bo/products/${productId}`
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
      router.push(BLOG_OPS_PRODUCTS_PATH)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!productId) return
    if (!confirm('이 제품을 삭제하시겠습니까?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/bo/products/${productId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('삭제 실패')
      router.push(BLOG_OPS_PRODUCTS_PATH)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  function handleCrawlDone() {
    // 크롤 성공 후 상태 낙관적 업데이트 — 페이지 새로고침으로 실제 데이터 동기화
    setCurrentCrawlStatus('DONE')
    setCurrentCrawledAt(new Date())
    router.refresh()
  }

  const formatDate = (d: Date | string | null) =>
    d
      ? new Intl.DateTimeFormat('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(d))
      : null

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* 기본 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">기본 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="name">제품명 *</Label>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => update('name', e.target.value)}
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">카테고리</Label>
            <Select
              value={state.category}
              onValueChange={(v) => update('category', v as ProductFormState['category'])}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="선택 안 함" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="B2B">B2B</SelectItem>
                <SelectItem value="B2C">B2C</SelectItem>
                <SelectItem value="기타">기타</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oneLinerPitch">한 줄 소개</Label>
            <Input
              id="oneLinerPitch"
              value={state.oneLinerPitch}
              onChange={(e) => update('oneLinerPitch', e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="homepageUrl">홈페이지 URL</Label>
            <Input
              id="homepageUrl"
              type="url"
              value={state.homepageUrl}
              onChange={(e) => update('homepageUrl', e.target.value)}
              placeholder="https://"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ctaUrl">CTA URL</Label>
            <Input
              id="ctaUrl"
              type="url"
              value={state.ctaUrl}
              onChange={(e) => update('ctaUrl', e.target.value)}
              placeholder="https://"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="targetCustomer">타겟 고객</Label>
            <Textarea
              id="targetCustomer"
              value={state.targetCustomer}
              onChange={(e) => update('targetCustomer', e.target.value)}
              rows={2}
              maxLength={500}
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

      {/* 제품 특장점 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">특장점</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.features.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex-1 rounded border bg-muted/50 px-3 py-1.5 text-sm">{f}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeFeature(i)}
                className="shrink-0"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFeature()
                }
              }}
              placeholder="특장점 입력 후 Enter 또는 추가 버튼"
              maxLength={300}
              className="flex-1"
            />
            <Button type="button" variant="outline" size="sm" onClick={addFeature}>
              추가
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 홈페이지 크롤링 (편집 모드에서만) */}
      {mode === 'edit' && productId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">홈페이지 크롤링</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {crawlStatusBadge(currentCrawlStatus)}
              {currentCrawledAt && (
                <span className="text-xs text-muted-foreground">
                  수집일: {formatDate(currentCrawledAt)}
                </span>
              )}
              <CrawlButton
                productId={productId}
                disabled={!state.homepageUrl && !initial?.homepageUrl}
                onDone={handleCrawlDone}
              />
            </div>

            {currentCrawledText && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setCrawledTextOpen((v) => !v)}
                >
                  {crawledTextOpen ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  수집 텍스트 미리보기
                </button>
                {crawledTextOpen && (
                  <pre className="mt-2 max-h-48 overflow-y-auto rounded border bg-muted/50 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {currentCrawledText.slice(0, 3000)}
                    {currentCrawledText.length > 3000 && '\n\n…(이하 생략)'}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 커스텀 필드 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">커스텀 필드</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            AI 소구점 발굴에 추가로 전달할 제품 속성을 자유롭게 정의하세요.
          </p>
          {state.customFields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={f.key}
                onChange={(e) => updateCustomFieldKey(i, e.target.value)}
                placeholder="키"
                className="w-36 shrink-0"
                maxLength={100}
              />
              <Input
                value={f.value}
                onChange={(e) => updateCustomFieldValue(i, e.target.value)}
                placeholder="값"
                className="flex-1"
                maxLength={2000}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeCustomField(i)}
                className="shrink-0"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addCustomField}>
            + 필드 추가
          </Button>
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
            onClick={() => router.push(BLOG_OPS_PRODUCTS_PATH)}
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
