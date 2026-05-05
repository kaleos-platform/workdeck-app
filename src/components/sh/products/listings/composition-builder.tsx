'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { productDisplayName } from '@/lib/sh/product-display'

/**
 * 판매채널 상품 구성 빌더.
 *
 * 단계별 UX:
 * 1) 상품 1개 선택
 * 2) 모드 선택
 *    - simple(수량 세트만 구성): 세트 수량 N 지정 → 모든 속성 cartesian으로 펼쳐 listing N개 생성
 *      (각 listing은 1옵션 × N수량)
 *    - advanced(옵션 선택 구성): 속성 체크 + 값별 수량 지정. 선택 안 된 속성은 모든 값 펼침
 * 3) 추가하기 → BuiltGroup[] 반환
 */

type ProductRow = {
  id: string
  name: string
  internalName?: string | null
  code: string | null
  brand?: { id: string; name: string } | null
}

type AttributeDef = { name: string; values: Array<{ value: string; code?: string }> }

type OptionRow = {
  id: string
  name: string
  sku: string | null
  retailPrice: number | null
  attributeValues: Record<string, string>
}

type ProductDetail = {
  id: string
  name: string
  internalName: string | null
  optionAttributes: AttributeDef[] | null
  brand: { id: string; name: string } | null
  options: OptionRow[]
}

type AttrState = {
  enabled: boolean
  valueQuantities: Record<string, number>
}

/**
 * advanced 모드의 한 "묶음".
 * 수량 지정 속성(attrState[name].enabled === true)별로 어떤 값에 몇 개씩 들어가는지.
 * 미선택 속성은 묶음과 무관하게 cartesian으로 펼쳐짐.
 */
type Bundle = {
  id: string
  valueQuantities: Record<string, Record<string, number>>
}

type BuilderMode = 'simple' | 'advanced'

export type ItemEntry = {
  optionId: string
  optionName: string
  sku: string | null
  quantity: number
  retailPrice: number | null
  attributeValues: Record<string, string>
}

export type BuiltGroup = {
  suffixParts: string[]
  items: ItemEntry[]
}

export type ProductContext = {
  id: string
  displayName: string
  officialName: string
  brandName: string | null
}

type Props = {
  onCommit: (product: ProductContext, groups: BuiltGroup[]) => void
  disabled?: boolean
}

export function CompositionBuilder({ onCommit, disabled }: Props) {
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<BuilderMode>('simple')

  // simple 모드
  const [setQuantities, setSetQuantities] = useState<number[]>([1])

  // advanced 모드
  const [attrState, setAttrState] = useState<Record<string, AttrState>>({})
  const [bundles, setBundles] = useState<Bundle[]>([{ id: 'b1', valueQuantities: {} }])

  // 상품이 바뀌면 상태 초기화
  useEffect(() => {
    if (!product) {
      setAttrState({})
      setSetQuantities([1])
      setBundles([{ id: 'b1', valueQuantities: {} }])
      setMode('simple')
      return
    }
    const next: Record<string, AttrState> = {}
    for (const attr of product.optionAttributes ?? []) {
      next[attr.name] = { enabled: false, valueQuantities: {} }
    }
    setAttrState(next)
    setBundles([{ id: `b-${Date.now()}`, valueQuantities: {} }])
  }, [product])

  function handlePickProduct(p: ProductRow) {
    setLoading(true)
    const load = async () => {
      try {
        const res = await fetch(`/api/sh/products/${p.id}`)
        if (!res.ok) throw new Error('상품 조회 실패')
        const data: {
          product: {
            id: string
            name: string
            internalName: string | null
            msrp?: string | number | null
            optionAttributes: AttributeDef[] | null
            brand: { id: string; name: string } | null
            options: Array<{
              id: string
              name: string
              sku: string | null
              retailPrice?: string | number | null
              attributeValues: Record<string, string> | null
            }>
          }
        } = await res.json()
        const prod = data.product
        const productMsrp = prod.msrp != null ? Number(prod.msrp) : null
        setProduct({
          id: prod.id,
          name: prod.name,
          internalName: prod.internalName,
          optionAttributes: Array.isArray(prod.optionAttributes) ? prod.optionAttributes : null,
          brand: prod.brand,
          options: prod.options.map((o) => ({
            id: o.id,
            name: o.name,
            sku: o.sku,
            retailPrice: o.retailPrice != null ? Number(o.retailPrice) : productMsrp,
            attributeValues: o.attributeValues ?? {},
          })),
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '상품 조회 실패')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }

  function toggleAttr(name: string, enabled: boolean) {
    setAttrState((prev) => ({
      ...prev,
      [name]: { enabled, valueQuantities: enabled ? (prev[name]?.valueQuantities ?? {}) : {} },
    }))
    // 속성을 끄면 묶음들에서도 해당 속성 정보 정리
    if (!enabled) {
      setBundles((prev) =>
        prev.map((b) => {
          if (!(name in b.valueQuantities)) return b
          const next = { ...b.valueQuantities }
          delete next[name]
          return { ...b, valueQuantities: next }
        })
      )
    }
  }

  function addBundle() {
    setBundles((prev) => [...prev, { id: `b-${Date.now()}-${prev.length}`, valueQuantities: {} }])
  }

  function removeBundle(id: string) {
    setBundles((prev) => (prev.length > 1 ? prev.filter((b) => b.id !== id) : prev))
  }

  function toggleBundleValue(bundleId: string, attrName: string, value: string, on: boolean) {
    setBundles((prev) =>
      prev.map((b) => {
        if (b.id !== bundleId) return b
        const attrMap = { ...(b.valueQuantities[attrName] ?? {}) }
        if (on) {
          attrMap[value] = attrMap[value] ?? 1
        } else {
          delete attrMap[value]
        }
        const nextVQ = { ...b.valueQuantities }
        if (Object.keys(attrMap).length === 0) delete nextVQ[attrName]
        else nextVQ[attrName] = attrMap
        return { ...b, valueQuantities: nextVQ }
      })
    )
  }

  function updateBundleValueQty(bundleId: string, attrName: string, value: string, qty: number) {
    setBundles((prev) =>
      prev.map((b) => {
        if (b.id !== bundleId) return b
        const attrMap = b.valueQuantities[attrName]
        if (!attrMap || !(value in attrMap)) return b
        return {
          ...b,
          valueQuantities: {
            ...b.valueQuantities,
            [attrName]: { ...attrMap, [value]: Math.max(1, qty) },
          },
        }
      })
    )
  }

  function toggleValue(attrName: string, value: string, on: boolean) {
    setAttrState((prev) => {
      const current = prev[attrName] ?? { enabled: true, valueQuantities: {} }
      const valueQuantities = { ...current.valueQuantities }
      if (on) {
        valueQuantities[value] = valueQuantities[value] ?? 1
      } else {
        delete valueQuantities[value]
      }
      return { ...prev, [attrName]: { ...current, valueQuantities } }
    })
  }

  function emit(groups: BuiltGroup[]) {
    if (!product) return
    const ctx: ProductContext = {
      id: product.id,
      displayName: productDisplayName(product),
      officialName: product.name,
      brandName: product.brand?.name ?? null,
    }
    onCommit(ctx, groups)
  }

  function handleCommit() {
    if (!product) return
    if (mode === 'simple') commitSimple()
    else commitAdvanced()
  }

  function commitSimple() {
    if (!product) return
    const attrs = product.optionAttributes ?? []
    const qtys = setQuantities.map((q) => Math.max(1, q))
    const includeQtySuffix = qtys.length > 1

    if (attrs.length === 0) {
      const defaultOpt = product.options[0]
      if (!defaultOpt) {
        toast.error('이 상품에는 선택할 옵션이 없습니다')
        return
      }
      emit(
        qtys.map((q) => ({
          suffixParts: includeQtySuffix ? [`${q}개`] : [],
          items: [
            {
              optionId: defaultOpt.id,
              optionName: defaultOpt.name,
              sku: defaultOpt.sku,
              quantity: q,
              retailPrice: defaultOpt.retailPrice,
              attributeValues: defaultOpt.attributeValues,
            },
          ],
        }))
      )
      return
    }

    // attrState에 활성화된 속성은 선택된 값만, 미활성 속성은 전체 값을 펼침
    const combos = attrs.reduce<Array<Record<string, string>>>((acc, attr) => {
      const state = attrState[attr.name]
      const selectedVals = state?.enabled ? Object.keys(state.valueQuantities) : []
      const vals = selectedVals.length > 0 ? selectedVals : attr.values.map((v) => v.value)
      if (acc.length === 0) return vals.map((v) => ({ [attr.name]: v }))
      return acc.flatMap((prev) => vals.map((v) => ({ ...prev, [attr.name]: v })))
    }, [])

    const groups: BuiltGroup[] = []
    for (const combo of combos) {
      const opt = findOption(product.options, combo)
      if (!opt) continue
      const baseParts = attrs.map((a) => combo[a.name])
      for (const q of qtys) {
        groups.push({
          suffixParts: includeQtySuffix ? [...baseParts, `${q}개`] : baseParts,
          items: [
            {
              optionId: opt.id,
              optionName: opt.name,
              sku: opt.sku,
              quantity: q,
              retailPrice: opt.retailPrice,
              attributeValues: opt.attributeValues,
            },
          ],
        })
      }
    }

    if (groups.length === 0) {
      toast.error('생성 가능한 옵션 조합이 없습니다')
      return
    }
    emit(groups)
  }

  function commitAdvanced() {
    if (!product) return
    const attrs = product.optionAttributes ?? []

    // 속성 없는 상품 — simple과 동일하게 처리
    if (attrs.length === 0) {
      const defaultOpt = product.options[0]
      if (!defaultOpt) {
        toast.error('이 상품에는 선택할 옵션이 없습니다')
        return
      }
      emit([
        {
          suffixParts: [],
          items: [
            {
              optionId: defaultOpt.id,
              optionName: defaultOpt.name,
              sku: defaultOpt.sku,
              quantity: 1,
              retailPrice: defaultOpt.retailPrice,
              attributeValues: defaultOpt.attributeValues,
            },
          ],
        },
      ])
      return
    }

    // 수량 지정 속성(enabled) / 미지정 속성(= 모든 값 펼침)
    const selectedAttrNames: string[] = []
    const unselected: Array<{ name: string; values: string[] }> = []
    for (const attr of attrs) {
      const st = attrState[attr.name]
      const vals = attr.values.map((v) => v.value)
      if (st?.enabled) {
        selectedAttrNames.push(attr.name)
      } else {
        unselected.push({ name: attr.name, values: vals })
      }
    }

    if (selectedAttrNames.length === 0) {
      toast.error('수량을 지정할 속성을 1개 이상 선택하세요')
      return
    }

    // 각 묶음에 수량 지정 속성에 대한 값·수량이 1개 이상 있어야 유효
    const validBundles = bundles.filter((b) =>
      selectedAttrNames.some(
        (n) => b.valueQuantities[n] && Object.keys(b.valueQuantities[n]).length > 0
      )
    )
    if (validBundles.length === 0) {
      toast.error('묶음마다 수량을 지정할 값을 1개 이상 선택하세요')
      return
    }

    // 미선택 속성의 cartesian
    const combos: Array<Record<string, string>> = unselected.reduce<Array<Record<string, string>>>(
      (acc, attr) => {
        if (acc.length === 0) return attr.values.map((v) => ({ [attr.name]: v }))
        const next: Array<Record<string, string>> = []
        for (const prev of acc) {
          for (const v of attr.values) {
            next.push({ ...prev, [attr.name]: v })
          }
        }
        return next
      },
      [] as Array<Record<string, string>>
    )
    const effectiveCombos = combos.length > 0 ? combos : [{}]

    const groups: BuiltGroup[] = []
    for (const combo of effectiveCombos) {
      // 각 묶음 → 별도 listing
      validBundles.forEach((bundle, bundleIdx) => {
        const groupItems: ItemEntry[] = []

        // 묶음 안의 수량 지정 속성·값 cartesian (속성 간 cartesian)
        type SelectedCombo = { values: Record<string, string>; qty: number }
        let selectedCombos: SelectedCombo[] = [{ values: {}, qty: 1 }]
        let bundleHasQty = false
        for (const name of selectedAttrNames) {
          const valueQty = bundle.valueQuantities[name]
          if (!valueQty || Object.keys(valueQty).length === 0) continue
          bundleHasQty = true
          const expanded: SelectedCombo[] = []
          for (const prev of selectedCombos) {
            for (const [value, q] of Object.entries(valueQty)) {
              expanded.push({
                values: { ...prev.values, [name]: value },
                qty: prev.qty === 1 ? q : prev.qty * q,
              })
            }
          }
          selectedCombos = expanded
        }
        if (!bundleHasQty) return

        for (const sc of selectedCombos) {
          const target = { ...combo, ...sc.values }
          const opt = findOption(product.options, target)
          if (!opt) continue
          groupItems.push({
            optionId: opt.id,
            optionName: opt.name,
            sku: opt.sku,
            quantity: sc.qty,
            retailPrice: opt.retailPrice,
            attributeValues: opt.attributeValues,
          })
        }

        if (groupItems.length === 0) return

        // suffix 구성: 미선택 속성값 + 묶음 식별 라벨
        const baseParts = unselected.map((a) => combo[a.name]).filter(Boolean)
        const bundleLabel =
          validBundles.length > 1 ? [`#${bundleIdx + 1} ${bundleSummary(bundle)}`] : []
        groups.push({
          suffixParts: [...baseParts, ...bundleLabel],
          items: groupItems,
        })
      })
    }

    if (groups.length === 0) {
      toast.error('구성 가능한 옵션 조합이 없습니다')
      return
    }
    emit(groups)
  }

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{product ? '구성 설정' : '1) 상품 선택'}</h3>
        {product && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setProduct(null)}
            disabled={disabled || loading}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            상품 다시 선택
          </Button>
        )}
      </div>

      {!product ? (
        <ProductSearchPane onPick={handlePickProduct} />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : (
        <div className="space-y-5">
          <SelectedProductHeader product={product} />

          <div className="space-y-2">
            <Label>2) 구성 방식</Label>
            <Tabs value={mode} onValueChange={(v) => setMode(v as BuilderMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="simple">수량 세트만 구성</TabsTrigger>
                <TabsTrigger value="advanced">옵션 선택 구성</TabsTrigger>
              </TabsList>

              <TabsContent value="simple" className="mt-3">
                <SimpleModeSettings
                  product={product}
                  setQuantities={setQuantities}
                  onAddBundle={() => setSetQuantities((prev) => [...prev, 1])}
                  onRemoveBundle={(idx) =>
                    setSetQuantities((prev) =>
                      prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev
                    )
                  }
                  onUpdateBundleQty={(idx, q) =>
                    setSetQuantities((prev) => prev.map((x, i) => (i === idx ? Math.max(1, q) : x)))
                  }
                  attrState={attrState}
                  onToggleAttr={toggleAttr}
                  onToggleValue={toggleValue}
                />
              </TabsContent>

              <TabsContent value="advanced" className="mt-3">
                <BundlesEditor
                  product={product}
                  attrState={attrState}
                  bundles={bundles}
                  onToggleAttr={toggleAttr}
                  onAddBundle={addBundle}
                  onRemoveBundle={removeBundle}
                  onToggleBundleValue={toggleBundleValue}
                  onUpdateBundleValueQty={updateBundleValueQty}
                />
                <AdvancedPreview product={product} attrState={attrState} bundles={bundles} />
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex justify-end border-t pt-3">
            <Button type="button" onClick={handleCommit} disabled={disabled}>
              <Plus className="mr-1 h-4 w-4" />
              추가하기
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 하위: 상품 검색 ─────────────────────────────────────────────────────────
function ProductSearchPane({ onPick }: { onPick: (p: ProductRow) => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('pageSize', '20')
        if (debounced.trim()) qs.set('search', debounced.trim())
        const res = await fetch(`/api/sh/products?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data?: ProductRow[]; products?: ProductRow[] } = await res.json()
        if (cancelled) return
        setResults(data.data ?? data.products ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [debounced])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명·관리코드 검색"
          className="pl-9"
          autoFocus
        />
      </div>
      <div className="max-h-[45vh] overflow-y-auto rounded-md border bg-background">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">검색 중...</div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {debounced ? '검색 결과가 없습니다' : '검색어를 입력하세요'}
          </div>
        ) : (
          <ul className="divide-y">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className="w-full px-4 py-2.5 text-left transition hover:bg-muted/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{productDisplayName(p)}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.code ? `코드 ${p.code}` : '코드 없음'}
                        {p.brand?.name ? ` · ${p.brand.name}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SelectedProductHeader({ product }: { product: ProductDetail }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
      <Badge variant="secondary">상품</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{productDisplayName(product)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {product.brand?.name ?? '브랜드 없음'} · 옵션 {product.options.length}개
        </p>
      </div>
    </div>
  )
}

// ─── Simple 모드 ─────────────────────────────────────────────────────────────
function SimpleModeSettings({
  product,
  setQuantities,
  onAddBundle,
  onRemoveBundle,
  onUpdateBundleQty,
  attrState,
  onToggleAttr,
  onToggleValue,
}: {
  product: ProductDetail
  setQuantities: number[]
  onAddBundle: () => void
  onRemoveBundle: (idx: number) => void
  onUpdateBundleQty: (idx: number, qty: number) => void
  attrState: Record<string, AttrState>
  onToggleAttr: (name: string, enabled: boolean) => void
  onToggleValue: (attrName: string, value: string, on: boolean) => void
}) {
  const attrs = product.optionAttributes ?? []
  const bundleCount = setQuantities.length

  // 선택된 cartesian (활성 속성은 선택값만, 미활성은 전체)
  const effectiveCombos: Record<string, string>[] = (() => {
    if (attrs.length === 0) return product.options.length > 0 ? [{}] : []
    let combos: Record<string, string>[] = [{}]
    for (const a of attrs) {
      const state = attrState[a.name]
      const selected = state?.enabled ? Object.keys(state.valueQuantities) : []
      const vals = selected.length > 0 ? selected : a.values.map((v) => v.value)
      const next: Record<string, string>[] = []
      for (const prev of combos) {
        for (const v of vals) next.push({ ...prev, [a.name]: v })
      }
      combos = next
    }
    return combos
  })()
  const comboCount = effectiveCombos.length
  const totalListings = comboCount * bundleCount

  const samples = effectiveCombos.slice(0, 3).map((c) =>
    attrs
      .map((a) => c[a.name])
      .filter(Boolean)
      .join(' / ')
  )

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="space-y-1.5">
        <Label>세트 수량</Label>
        <div className="space-y-1.5">
          {setQuantities.map((q, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={999}
                value={q}
                onChange={(e) => onUpdateBundleQty(idx, Math.max(1, Number(e.target.value || 1)))}
                className="h-9 w-24"
              />
              <span className="text-xs text-muted-foreground">
                {idx === 0 ? '선택한 옵션 조합마다 이 수량이 적용됩니다' : `번들 세트 ${idx + 1}`}
              </span>
              {bundleCount > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemoveBundle(idx)}
                  aria-label="세트 수량 제거"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={onAddBundle}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            번들세트 추가
          </Button>
        </div>
      </div>

      {attrs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium">옵션 선택 (선택 안 하면 전체)</div>
          <div className="space-y-2">
            {attrs.map((attr) => {
              const state = attrState[attr.name] ?? { enabled: false, valueQuantities: {} }
              return (
                <div key={attr.name} className="rounded-md border p-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={state.enabled}
                      onCheckedChange={(v) => onToggleAttr(attr.name, v === true)}
                    />
                    <span className="font-medium">{attr.name}</span>
                    <span className="text-muted-foreground">(값 {attr.values.length}개)</span>
                  </label>
                  {state.enabled && (
                    <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                      {attr.values.map((v) => {
                        const checked = state.valueQuantities[v.value] !== undefined
                        return (
                          <label
                            key={v.value}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                              checked ? 'border-primary bg-primary/10' : 'hover:bg-muted'
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => onToggleValue(attr.name, v.value, c === true)}
                            />
                            <span>{v.value}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-foreground">{totalListings}</strong>개의 판매 옵션이 생성됩니다 ·{' '}
        {bundleCount > 1
          ? `옵션 조합 ${comboCount}개 × 세트 수량 ${bundleCount}종 (${setQuantities.join(', ')})`
          : `각 판매 옵션 = 1 옵션 × ${setQuantities[0]} 수량`}
        {samples.length > 0 && (
          <span className="mt-0.5 block">
            예: {samples.join(', ')}
            {comboCount > samples.length && ` 외 ${comboCount - samples.length}개`}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Advanced 모드 ───────────────────────────────────────────────────────────
function BundlesEditor({
  product,
  attrState,
  bundles,
  onToggleAttr,
  onAddBundle,
  onRemoveBundle,
  onToggleBundleValue,
  onUpdateBundleValueQty,
}: {
  product: ProductDetail
  attrState: Record<string, AttrState>
  bundles: Bundle[]
  onToggleAttr: (name: string, enabled: boolean) => void
  onAddBundle: () => void
  onRemoveBundle: (id: string) => void
  onToggleBundleValue: (bundleId: string, attrName: string, value: string, on: boolean) => void
  onUpdateBundleValueQty: (bundleId: string, attrName: string, value: string, qty: number) => void
}) {
  const attrs = product.optionAttributes ?? []
  if (attrs.length === 0) {
    return (
      <div className="rounded-md bg-background px-3 py-3 text-sm text-muted-foreground">
        이 상품은 속성이 정의되어 있지 않습니다 — 추가하기를 누르면 기본 옵션 1개로 구성됩니다
      </div>
    )
  }
  const selectedAttrs = attrs.filter((a) => attrState[a.name]?.enabled)
  return (
    <div className="space-y-4">
      {/* 1) 어떤 속성을 "수량 지정"으로 다룰지 선택 */}
      <div className="space-y-2">
        <Label className="text-xs">수량 지정 속성</Label>
        <p className="text-xs text-muted-foreground">
          선택한 속성은 묶음별로 값·수량을 지정합니다. 선택 안 된 속성은 모든 값에 기본 적용되어
          판매 옵션이 자동으로 나뉘어 생성됩니다
        </p>
        <div className="flex flex-wrap gap-2">
          {attrs.map((attr) => {
            const enabled = attrState[attr.name]?.enabled ?? false
            return (
              <label
                key={attr.name}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                  enabled ? 'border-primary bg-primary/10' : 'hover:bg-muted'
                }`}
              >
                <Checkbox
                  checked={enabled}
                  onCheckedChange={(v) => onToggleAttr(attr.name, v === true)}
                />
                <span className="font-medium">{attr.name}</span>
                <span className="text-muted-foreground">(값 {attr.values.length}개)</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* 2) 묶음 카드 */}
      {selectedAttrs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">묶음 ({bundles.length}개)</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onAddBundle}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              묶음 추가
            </Button>
          </div>
          <div className="space-y-2">
            {bundles.map((bundle, idx) => (
              <div key={bundle.id} className="rounded-md border bg-background px-3 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">묶음 #{idx + 1}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {bundleSummary(bundle) || '값을 선택하세요'}
                    </span>
                  </div>
                  {bundles.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveBundle(bundle.id)}
                      aria-label="묶음 제거"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="space-y-2.5">
                  {selectedAttrs.map((attr) => {
                    const valueMap = bundle.valueQuantities[attr.name] ?? {}
                    return (
                      <div key={attr.name}>
                        <div className="mb-1 text-xs font-medium">{attr.name}</div>
                        <div className="space-y-1 pl-1">
                          {attr.values.map((v) => {
                            const checked = v.value in valueMap
                            return (
                              <div key={v.value} className="flex items-center gap-2">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(on) =>
                                    onToggleBundleValue(bundle.id, attr.name, v.value, on === true)
                                  }
                                />
                                <span className="min-w-[80px] text-sm">{v.value}</span>
                                {checked && (
                                  <>
                                    <span className="text-xs text-muted-foreground">수량</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={999}
                                      value={valueMap[v.value] ?? 1}
                                      onChange={(e) =>
                                        onUpdateBundleValueQty(
                                          bundle.id,
                                          attr.name,
                                          v.value,
                                          Number(e.target.value || 1)
                                        )
                                      }
                                      className="h-7 w-20"
                                    />
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AdvancedPreview({
  product,
  attrState,
  bundles,
}: {
  product: ProductDetail
  attrState: Record<string, AttrState>
  bundles: Bundle[]
}) {
  const preview = useMemo(
    () => computeAdvancedPreview(product, attrState, bundles),
    [product, attrState, bundles]
  )
  return (
    <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      {preview.groupCount > 0 ? (
        <>
          <strong className="text-foreground">{preview.groupCount}</strong>개의 판매 옵션이
          생성됩니다
          {preview.samples.length > 0 && (
            <span className="mt-0.5 block">
              예: {preview.samples.join(', ')}
              {preview.groupCount > preview.samples.length &&
                ` 외 ${preview.groupCount - preview.samples.length}개`}
            </span>
          )}
        </>
      ) : (
        <span>수량 지정 속성을 선택하고 묶음마다 값을 1개 이상 골라야 미리 보기가 표시됩니다</span>
      )}
    </div>
  )
}

// ─── 로직 유틸 ───────────────────────────────────────────────────────────────

function findOption(options: OptionRow[], target: Record<string, string>): OptionRow | null {
  const keys = Object.keys(target)
  if (keys.length === 0) return options[0] ?? null
  for (const opt of options) {
    let match = true
    for (const k of keys) {
      if (opt.attributeValues[k] !== target[k]) {
        match = false
        break
      }
    }
    if (match) return opt
  }
  return null
}

function bundleSummary(bundle: Bundle): string {
  const parts: string[] = []
  for (const [, valMap] of Object.entries(bundle.valueQuantities)) {
    for (const [val, qty] of Object.entries(valMap)) {
      parts.push(`${val}×${qty}`)
    }
  }
  return parts.join(' + ')
}

function computeAdvancedPreview(
  product: ProductDetail,
  attrState: Record<string, AttrState>,
  bundles: Bundle[]
): { groupCount: number; samples: string[] } {
  const attrs = product.optionAttributes ?? []
  if (attrs.length === 0) {
    return { groupCount: product.options.length > 0 ? 1 : 0, samples: [] }
  }
  const selectedAttrNames = attrs.filter((a) => attrState[a.name]?.enabled).map((a) => a.name)
  if (selectedAttrNames.length === 0) return { groupCount: 0, samples: [] }

  const validBundles = bundles.filter((b) =>
    selectedAttrNames.some(
      (n) => b.valueQuantities[n] && Object.keys(b.valueQuantities[n]).length > 0
    )
  )
  if (validBundles.length === 0) return { groupCount: 0, samples: [] }

  const unselectedValues: Array<{ name: string; values: string[] }> = []
  for (const a of attrs) {
    if (!selectedAttrNames.includes(a.name)) {
      unselectedValues.push({ name: a.name, values: a.values.map((v) => v.value) })
    }
  }
  const unselectedCount = unselectedValues.reduce((n, arr) => n * arr.values.length, 1)
  const groupCount = unselectedCount * validBundles.length

  // 샘플: 미선택 속성 cartesian (최대 3) × 묶음 라벨 (첫 묶음 1개)
  let combos: string[][] = [[]]
  for (const av of unselectedValues) {
    const next: string[][] = []
    for (const prev of combos) {
      for (const v of av.values) {
        next.push([...prev, v])
        if (next.length >= 3) break
      }
      if (next.length >= 3) break
    }
    combos = next
    if (combos.length >= 3) break
  }
  const baseSamples = combos.length === 0 ? [''] : combos.slice(0, 3).map((c) => c.join(' / '))
  const samples = baseSamples
    .map((base) => {
      const bundleLabel = validBundles.length > 1 ? `#1 ${bundleSummary(validBundles[0])}` : ''
      if (!base && !bundleLabel) return ''
      if (!base) return bundleLabel
      if (!bundleLabel) return base
      return `${base} · ${bundleLabel}`
    })
    .filter(Boolean)
  return { groupCount, samples }
}
