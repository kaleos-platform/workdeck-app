'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
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
 * - 속성 정의를 편집하고 저장 시 조합 diff로 옵션 CRUD를 실행한다.
 * - 저장 버튼은 경고 모달로 확인 후 API 호출.
 */
export function ProductAttributesEditor({ productId, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [product, setProduct] = useState<ProductResp | null>(null)
  const [attributes, setAttributes] = useState<OptionAttribute[]>([])
  const [combinations, setCombinations] = useState<CombinationRow[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

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
            skuManual: !!o.sku, // 기존에 값 있으면 수동 보존
            costPrice: o.costPrice != null ? String(o.costPrice) : '',
            retailPrice: o.retailPrice != null ? String(o.retailPrice) : '',
          }
        })
        setCombinations(rows)
      } else {
        setCombinations([])
      }
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave() {
    if (!product) return

    // 유효 속성만 저장 대상
    const validAttrs = attributes.filter((a) => a.name.trim() && a.values.length > 0)
    if (validAttrs.length === 0) {
      toast.error('최소 1개 속성과 값이 필요합니다')
      return
    }

    setSaving(true)
    try {
      // 1) 상품 optionAttributes 저장 + Space alias 자동 학습 (한 번의 PATCH)
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

      // 2) 옵션 diff: 기존 options와 새 combinations 비교
      const existingByCombKey = new Map(
        product.options.map((o) => {
          const av = o.attributeValues ?? {}
          const comb = validAttrs.map((a) => String(av[a.name] ?? ''))
          return [comb.join('|'), o]
        })
      )

      const targetCombKeys = new Set(combinations.map((r) => r.combination.join('|')))

      // 2a) 신규 + 유지 업데이트
      for (const row of combinations) {
        const key = row.combination.join('|')
        const existing = existingByCombKey.get(key)
        const attributeValues: Record<string, string> = {}
        validAttrs.forEach((a, i) => {
          attributeValues[a.name] = row.combination[i] ?? ''
        })
        const name = row.combination.join(' / ')
        const costPrice = row.costPrice ? parseFloat(row.costPrice) : null
        const retailPrice = row.retailPrice ? parseFloat(row.retailPrice) : null

        if (existing) {
          // 기존 옵션 업데이트 (sku/원가/소비자가 변경 감지 시만)
          const prevSku = existing.sku ?? ''
          const prevCost = existing.costPrice != null ? Number(existing.costPrice) : null
          const prevRetail = existing.retailPrice != null ? Number(existing.retailPrice) : null
          const changed =
            prevSku !== row.sku ||
            prevCost !== costPrice ||
            prevRetail !== retailPrice ||
            existing.name !== name
          if (changed) {
            const res = await fetch(`/api/sh/products/${productId}/options/${existing.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                sku: row.sku || null,
                costPrice,
                retailPrice,
                attributeValues,
              }),
            })
            if (!res.ok) {
              const err = await res.json().catch(() => ({}))
              throw new Error(err?.message ?? '옵션 업데이트 실패')
            }
          }
        } else {
          // 신규 옵션
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
      }

      // 2b) 사라진 옵션 삭제
      for (const existing of product.options) {
        const av = existing.attributeValues ?? {}
        const comb = validAttrs.map((a) => String(av[a.name] ?? ''))
        if (!targetCombKeys.has(comb.join('|'))) {
          await fetch(`/api/sh/products/${productId}/options/${existing.id}`, {
            method: 'DELETE',
          }).catch(() => null)
        }
      }

      toast.success('옵션 속성이 저장되었습니다')
      setConfirmOpen(false)
      await load()
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // 저장 후보 — 기존 데이터가 변경될 수 있는지 빠른 판단 (삭제 조합이 있는지)
  function hasDestructiveChange(): boolean {
    if (!product) return false
    const validAttrs = attributes.filter((a) => a.name.trim() && a.values.length > 0)
    if (validAttrs.length === 0) return false
    const targetKeys = new Set(combinations.map((r) => r.combination.join('|')))
    for (const o of product.options) {
      const av = o.attributeValues ?? {}
      const comb = validAttrs.map((a) => String(av[a.name] ?? ''))
      if (!targetKeys.has(comb.join('|'))) return true
    }
    return false
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">불러오는 중...</p>
  }

  const destructive = hasDestructiveChange()

  return (
    <div className="space-y-4">
      <ProductOptionAttributesEditor
        attributes={attributes}
        combinations={combinations}
        onAttributesChange={setAttributes}
        onCombinationsChange={setCombinations}
        productCode={product?.code ?? null}
      />

      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          속성/조합 저장
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              옵션 속성 변경 확인
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>속성을 저장하면 다음 작업이 실행됩니다:</p>
                <ul className="list-disc pl-5 text-xs">
                  <li>상품의 속성 정의(이름·값·코드)가 갱신됩니다.</li>
                  <li>신규 조합은 옵션이 자동 추가됩니다.</li>
                  <li>기존 조합의 관리코드·원가·소비자가가 입력값으로 갱신됩니다.</li>
                  <li>
                    {destructive ? (
                      <span className="text-destructive">
                        속성 값이 삭제된 경우 관련 옵션이 삭제됩니다 (재고/입출고 기록도 함께).
                      </span>
                    ) : (
                      <span>삭제되는 옵션은 없습니다.</span>
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
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              계속
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
