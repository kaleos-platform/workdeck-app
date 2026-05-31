'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ProductOptionAttributesEditor,
  type CombinationRow,
  type OptionAttribute,
} from '@/components/sh/products/product-option-attributes-editor'
import { normalizeOptionAttributes } from '@/lib/sh/option-code'

type Props = {
  productId: string
  /** 저장 후 옵션 테이블 refresh 트리거 */
  onSaved?: () => void
}

type ProductResp = {
  id: string
  code: string | null
  optionAttributes: unknown
  options: Array<{
    id: string
    name: string
    sku: string | null
    costPrice: number | string | null
    retailPrice: number | string | null
    attributeValues: Record<string, string> | null
  }>
}

/**
 * 상품 상세의 "옵션 속성" 섹션.
 * - 옵션이 이미 있으면 요약 표시 + "옵션 속성 수정" 버튼으로 편집 모드 진입.
 * - 옵션이 없으면 바로 편집 모드.
 * - "옵션 적용" 버튼 하나로 optionAttributes PATCH + 옵션 동기화(add/delete) 처리.
 */
export function ProductAttributesEditor({ productId, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [product, setProduct] = useState<ProductResp | null>(null)
  const [attributes, setAttributes] = useState<OptionAttribute[]>([])
  const [combinations, setCombinations] = useState<CombinationRow[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${productId}`)
      if (!res.ok) return
      const json = await res.json()
      const prod: ProductResp = json.product ?? json
      setProduct(prod)

      const initialAttrs = normalizeOptionAttributes(prod.optionAttributes)
      setAttributes(initialAttrs)

      // 기존 옵션에서 combinations 초기화
      if (initialAttrs.length > 0 && prod.options?.length > 0) {
        const rows: CombinationRow[] = prod.options.map((o) => {
          const combination = initialAttrs.map((attr) => {
            const av = o.attributeValues ?? {}
            return String(av[attr.name] ?? '')
          })
          return {
            combination,
            sku: o.sku ?? '',
            skuManual: !!o.sku,
            costPrice: o.costPrice != null ? String(o.costPrice) : '',
            retailPrice: o.retailPrice != null ? String(o.retailPrice) : '',
          }
        })
        setCombinations(rows)
        setIsEditing(false) // 옵션 있으면 접힘
      } else {
        setCombinations([])
        setIsEditing(true) // 옵션 없으면 바로 편집 모드
      }
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void load()
  }, [load])

  // "옵션 적용" — optionAttributes PATCH 후 옵션 동기화(add/delete)
  async function handleApplyOptions() {
    if (!product) return
    const validAttrs = attributes.filter((a) => a.name.trim() && a.values.length > 0)
    if (validAttrs.length === 0) {
      toast.error('최소 1개 속성과 값이 필요합니다')
      return
    }

    setSaving(true)
    try {
      // 1. optionAttributes PATCH (상품 단위 속성 정의 저장)
      const patchRes = await fetch(`/api/sh/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          optionAttributes: validAttrs.map((a) => ({
            name: a.name.trim(),
            values: a.values.map((v) => ({ value: v.value, code: v.code })),
          })),
        }),
      })
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}))
        throw new Error(err?.message ?? '속성 저장 실패')
      }

      // 2. 옵션 동기화 (add/delete)
      const existingByCombKey = new Map(
        product.options.map((o) => {
          const av = o.attributeValues ?? {}
          const comb = validAttrs.map((a) => String(av[a.name] ?? ''))
          return [comb.join('|'), o]
        })
      )
      const targetCombKeys = new Set(combinations.map((r) => r.combination.join('|')))

      // 조합별 처리: 신규 → POST, 기존 유지 → attributeValues/name PATCH
      for (const row of combinations) {
        const key = row.combination.join('|')
        const attributeValues: Record<string, string> = {}
        validAttrs.forEach((a, i) => {
          attributeValues[a.name] = row.combination[i] ?? ''
        })
        const name = row.combination.join(' / ')

        const existing = existingByCombKey.get(key)
        if (existing) {
          // 속성명/값 변경 반영 (name, attributeValues 갱신)
          const needsPatch =
            existing.name !== name ||
            JSON.stringify(existing.attributeValues) !== JSON.stringify(attributeValues)
          if (needsPatch) {
            await fetch(`/api/sh/products/${productId}/options/${existing.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, attributeValues }),
            }).catch(() => null)
          }
          continue
        }

        const costPrice = row.costPrice ? parseFloat(row.costPrice) : null
        const retailPrice = row.retailPrice ? parseFloat(row.retailPrice) : null

        const res = await fetch(`/api/sh/products/${productId}/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            sku: row.sku || undefined,
            costPrice: costPrice ?? undefined,
            retailPrice: retailPrice ?? undefined,
            attributeValues,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.message ?? '옵션 추가 실패')
        }
      }

      // 사라진 옵션 삭제
      for (const existing of product.options) {
        const av = existing.attributeValues ?? {}
        const comb = validAttrs.map((a) => String(av[a.name] ?? ''))
        if (!targetCombKeys.has(comb.join('|'))) {
          await fetch(`/api/sh/products/${productId}/options/${existing.id}`, {
            method: 'DELETE',
          }).catch(() => null)
        }
      }

      const preHad = (product.options?.length ?? 0) > 0
      if (!preHad) {
        toast.success(`${combinations.length}개 옵션이 생성되었습니다`)
      } else {
        toast.success('옵션 리스트가 동기화되었습니다')
      }
      setConfirmOpen(false)
      setIsEditing(false)
      await load()
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '동기화 실패')
    } finally {
      setSaving(false)
    }
  }

  function computeDiff(): { added: string[]; kept: string[]; removed: string[] } {
    if (!product) return { added: [], kept: [], removed: [] }
    const validAttrs = attributes.filter((a) => a.name.trim() && a.values.length > 0)
    if (validAttrs.length === 0) return { added: [], kept: [], removed: [] }

    const existingKeys = new Set(
      product.options.map((o) => {
        const av = o.attributeValues ?? {}
        return validAttrs.map((a) => String(av[a.name] ?? '')).join('|')
      })
    )
    const targetKeys = new Set(combinations.map((r) => r.combination.join('|')))

    const added: string[] = []
    const kept: string[] = []
    for (const row of combinations) {
      const key = row.combination.join('|')
      const label = row.combination.join(' / ')
      if (existingKeys.has(key)) kept.push(label)
      else added.push(label)
    }

    const removed: string[] = []
    for (const o of product.options) {
      const av = o.attributeValues ?? {}
      const comb = validAttrs.map((a) => String(av[a.name] ?? ''))
      if (!targetKeys.has(comb.join('|'))) removed.push(comb.join(' / '))
    }

    return { added, kept, removed }
  }

  function handleApplyOptionsClick() {
    const willRemove = computeDiff().removed.length > 0
    if (willRemove) {
      setConfirmOpen(true)
    } else {
      void handleApplyOptions()
    }
  }

  function handleCancel() {
    void load()
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  // 접힘 상태 — 옵션 있고 편집 모드 아닐 때
  if (!isEditing) {
    const attrSummary = attributes
      .map((a) => `${a.name}: ${a.values.map((v) => v.value).join(', ')}`)
      .join(' / ')
    return (
      <div className="flex items-center justify-between rounded-md border px-4 py-3">
        <p className="text-sm text-muted-foreground">{attrSummary || '속성 정의 없음'}</p>
        <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} className="shrink-0">
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          옵션 속성 수정
        </Button>
      </div>
    )
  }

  // 편집 모드
  const diff = computeDiff()
  const destructive = diff.removed.length > 0
  const sample = (arr: string[], n = 3) =>
    arr.length <= n ? arr.join(', ') : `${arr.slice(0, n).join(', ')} …`
  const hasExistingOptions = (product?.options?.length ?? 0) > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {hasExistingOptions && (
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
            취소
          </Button>
        )}
        <Button size="sm" onClick={handleApplyOptionsClick} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          옵션 적용
        </Button>
      </div>

      <ProductOptionAttributesEditor
        attributes={attributes}
        combinations={combinations}
        onAttributesChange={setAttributes}
        onCombinationsChange={setCombinations}
        productCode={product?.code ?? null}
        showCombinationsPreview={false}
        excludeProductId={productId}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              옵션 속성 변경 확인
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>저장 시 다음이 적용됩니다:</p>
                <ul className="list-disc pl-5 text-xs">
                  <li>
                    <span className="font-medium">추가: {diff.added.length}개</span>
                    {diff.added.length > 0 && (
                      <span className="text-muted-foreground"> — {sample(diff.added)}</span>
                    )}
                  </li>
                  <li>
                    <span className="font-medium">유지: {diff.kept.length}개</span>
                    <span className="text-muted-foreground">
                      {' '}
                      (기존 관리코드·원가·소비자가 유지 — 변경은 아래 옵션 테이블에서)
                    </span>
                  </li>
                  <li className={destructive ? 'text-destructive' : undefined}>
                    <span className="font-medium">삭제: {diff.removed.length}개</span>
                    {destructive && (
                      <>
                        <span> — {sample(diff.removed)}</span>
                        <span className="block text-xs">⚠ 재고/입출고 기록도 함께 삭제됩니다.</span>
                      </>
                    )}
                  </li>
                </ul>
                <p className="text-xs text-muted-foreground">
                  입력한 값-코드는 이 Space의 자동 학습 사전에 저장되어 다음부터 자동 제안됩니다.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button onClick={handleApplyOptions} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              계속
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
