'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Plus, Search } from 'lucide-react'
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
  const [setQty, setSetQty] = useState<number>(1)

  // advanced 모드
  const [attrState, setAttrState] = useState<Record<string, AttrState>>({})

  // 상품이 바뀌면 상태 초기화
  useEffect(() => {
    if (!product) {
      setAttrState({})
      setSetQty(1)
      setMode('simple')
      return
    }
    const next: Record<string, AttrState> = {}
    for (const attr of product.optionAttributes ?? []) {
      next[attr.name] = { enabled: false, valueQuantities: {} }
    }
    setAttrState(next)
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
            retailPrice: o.retailPrice != null ? Number(o.retailPrice) : null,
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

  function updateValueQty(attrName: string, value: string, qty: number) {
    setAttrState((prev) => {
      const current = prev[attrName]
      if (!current) return prev
      return {
        ...prev,
        [attrName]: {
          ...current,
          valueQuantities: { ...current.valueQuantities, [value]: Math.max(1, qty) },
        },
      }
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
    const qty = Math.max(1, setQty)

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
              quantity: qty,
              retailPrice: defaultOpt.retailPrice,
              attributeValues: defaultOpt.attributeValues,
            },
          ],
        },
      ])
      return
    }

    // 모든 속성의 cartesian 펼침
    const combos = attrs.reduce<Array<Record<string, string>>>((acc, attr) => {
      const vals = attr.values.map((v) => v.value)
      if (acc.length === 0) return vals.map((v) => ({ [attr.name]: v }))
      return acc.flatMap((prev) => vals.map((v) => ({ ...prev, [attr.name]: v })))
    }, [])

    const groups: BuiltGroup[] = []
    for (const combo of combos) {
      const opt = findOption(product.options, combo)
      if (!opt) continue
      groups.push({
        suffixParts: attrs.map((a) => combo[a.name]),
        items: [
          {
            optionId: opt.id,
            optionName: opt.name,
            sku: opt.sku,
            quantity: qty,
            retailPrice: opt.retailPrice,
            attributeValues: opt.attributeValues,
          },
        ],
      })
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

    // 선택된 속성(= 값·수량 지정) / 선택 안 된 속성(= 모든 값 펼침)
    const selected: Array<{ name: string; valueQuantities: Record<string, number> }> = []
    const unselected: Array<{ name: string; values: string[] }> = []
    for (const attr of attrs) {
      const st = attrState[attr.name]
      const vals = attr.values.map((v) => v.value)
      const hasQty = st?.enabled && Object.keys(st.valueQuantities).length > 0
      if (hasQty) {
        selected.push({
          name: attr.name,
          valueQuantities: { ...st!.valueQuantities },
        })
      } else {
        unselected.push({ name: attr.name, values: vals })
      }
    }

    if (selected.length === 0) {
      toast.error('수량을 지정할 속성과 값을 1개 이상 선택하세요')
      return
    }

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
      const groupItems: ItemEntry[] = []

      // selected 속성들의 value × quantity Cartesian
      type SelectedCombo = { values: Record<string, string>; qty: number }
      let selectedCombos: SelectedCombo[] = [{ values: {}, qty: 1 }]
      for (const s of selected) {
        const expanded: SelectedCombo[] = []
        for (const prev of selectedCombos) {
          for (const [value, q] of Object.entries(s.valueQuantities)) {
            expanded.push({
              values: { ...prev.values, [s.name]: value },
              qty: prev.qty === 1 ? q : prev.qty * q,
            })
          }
        }
        selectedCombos = expanded
      }

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

      if (groupItems.length === 0) continue
      const suffixParts = unselected.map((a) => combo[a.name]).filter(Boolean)
      groups.push({ suffixParts, items: groupItems })
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
                <SimpleModeSettings product={product} setQty={setQty} onSetQtyChange={setSetQty} />
              </TabsContent>

              <TabsContent value="advanced" className="mt-3">
                <AttributesPicker
                  product={product}
                  attrState={attrState}
                  onToggleAttr={toggleAttr}
                  onToggleValue={toggleValue}
                  onUpdateQty={updateValueQty}
                />
                <AdvancedPreview product={product} attrState={attrState} />
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
  setQty,
  onSetQtyChange,
}: {
  product: ProductDetail
  setQty: number
  onSetQtyChange: (v: number) => void
}) {
  const attrs = product.optionAttributes ?? []
  const comboCount =
    attrs.length === 0
      ? product.options.length > 0
        ? 1
        : 0
      : attrs.reduce((n, a) => n * a.values.length, 1)
  const sample =
    attrs.length === 0
      ? (product.options[0]?.name ?? null)
      : attrs
          .map((a) => a.values[0]?.value)
          .filter(Boolean)
          .join(' / ')

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="space-y-1.5">
        <Label htmlFor="set-qty">세트 수량</Label>
        <div className="flex items-center gap-2">
          <Input
            id="set-qty"
            type="number"
            min={1}
            max={999}
            value={setQty}
            onChange={(e) => onSetQtyChange(Math.max(1, Number(e.target.value || 1)))}
            className="h-9 w-24"
          />
          <span className="text-xs text-muted-foreground">
            이 수량이 모든 옵션 조합에 각각 적용됩니다
          </span>
        </div>
      </div>
      <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <strong className="text-foreground">{comboCount}</strong>개의 listing이 생성됩니다 · 각
        listing = 1 옵션 × {setQty} 수량
        {sample && <span className="block">예: {sample}</span>}
      </div>
    </div>
  )
}

// ─── Advanced 모드 ───────────────────────────────────────────────────────────
function AttributesPicker({
  product,
  attrState,
  onToggleAttr,
  onToggleValue,
  onUpdateQty,
}: {
  product: ProductDetail
  attrState: Record<string, AttrState>
  onToggleAttr: (name: string, enabled: boolean) => void
  onToggleValue: (name: string, value: string, on: boolean) => void
  onUpdateQty: (name: string, value: string, qty: number) => void
}) {
  const attrs = product.optionAttributes ?? []
  if (attrs.length === 0) {
    return (
      <div className="rounded-md bg-background px-3 py-3 text-sm text-muted-foreground">
        이 상품은 속성이 정의되어 있지 않습니다 — 추가하기를 누르면 기본 옵션 1개로 구성됩니다
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        선택 안 된 속성은 모든 값에 기본 적용되어 listing이 자동으로 나뉘어 생성됩니다
      </p>
      {attrs.map((attr) => {
        const st = attrState[attr.name] ?? { enabled: false, valueQuantities: {} }
        return (
          <div key={attr.name} className="rounded-md border bg-background px-3 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`attr-${attr.name}`}
                  checked={st.enabled}
                  onCheckedChange={(v) => onToggleAttr(attr.name, v === true)}
                />
                <Label htmlFor={`attr-${attr.name}`} className="text-sm font-medium">
                  {attr.name}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {st.enabled ? '지정' : '선택 안 함 (모든 값에 기본 적용)'}
                </span>
              </div>
            </div>
            {st.enabled && (
              <div className="mt-2 space-y-1.5 pl-6">
                {attr.values.map((v) => {
                  const checked = v.value in st.valueQuantities
                  return (
                    <div key={v.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`val-${attr.name}-${v.value}`}
                        checked={checked}
                        onCheckedChange={(on) => onToggleValue(attr.name, v.value, on === true)}
                      />
                      <Label
                        htmlFor={`val-${attr.name}-${v.value}`}
                        className="min-w-[80px] text-sm"
                      >
                        {v.value}
                      </Label>
                      {checked && (
                        <>
                          <span className="text-xs text-muted-foreground">수량</span>
                          <Input
                            type="number"
                            min={1}
                            max={999}
                            value={st.valueQuantities[v.value] ?? 1}
                            onChange={(e) =>
                              onUpdateQty(attr.name, v.value, Number(e.target.value || 1))
                            }
                            className="h-7 w-20"
                          />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AdvancedPreview({
  product,
  attrState,
}: {
  product: ProductDetail
  attrState: Record<string, AttrState>
}) {
  const preview = useMemo(() => computeAdvancedPreview(product, attrState), [product, attrState])
  return (
    <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      {preview.groupCount > 0 ? (
        <>
          <strong className="text-foreground">{preview.groupCount}</strong>개의 listing이 생성됩니다
          {preview.sample && <span className="block">예: {preview.sample}</span>}
        </>
      ) : (
        <span>수량을 지정한 속성·값이 있으면 미리 보기가 표시됩니다</span>
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

function computeAdvancedPreview(
  product: ProductDetail,
  attrState: Record<string, AttrState>
): { groupCount: number; selectedCount: number; sample: string | null } {
  const attrs = product.optionAttributes ?? []
  if (attrs.length === 0) {
    return { groupCount: product.options.length > 0 ? 1 : 0, selectedCount: 0, sample: null }
  }
  let selectedCount = 0
  const unselectedValues: string[][] = []
  for (const a of attrs) {
    const st = attrState[a.name]
    const hasQty = st?.enabled && Object.keys(st.valueQuantities).length > 0
    if (hasQty) {
      selectedCount += Object.keys(st!.valueQuantities).length
    } else {
      unselectedValues.push(a.values.map((v) => v.value))
    }
  }
  if (selectedCount === 0) return { groupCount: 0, selectedCount: 0, sample: null }
  const groupCount = unselectedValues.reduce((n, arr) => n * arr.length, 1)
  const sampleValues = unselectedValues.map((vs) => vs[0])
  const sample = sampleValues.length > 0 ? sampleValues.join(' / ') : null
  return { groupCount, selectedCount, sample }
}
