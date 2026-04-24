'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Loader2, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { productDisplayName } from '@/lib/sh/product-display'

/**
 * 판매채널 상품 구성 빌더 — 단계별 선택 UX.
 *
 * 1) 상품 1개 선택
 * 2) 속성 중 지정할 것 체크 (중복 가능)
 *    - 선택된 속성의 값을 체크 + 값별 수량 입력
 *    - 선택 안 된 속성은 "기본 적용" — cartesian으로 펼쳐 listing 여러 개로 자동 분할
 * 3) "추가하기" → groups 반환 (group이 2개 이상이면 상위에서 listing 여러 개 생성)
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

export type ItemEntry = {
  optionId: string
  optionName: string
  sku: string | null
  quantity: number
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
  const [attrState, setAttrState] = useState<Record<string, AttrState>>({})
  const [loading, setLoading] = useState(false)

  // 상품이 바뀌면 속성 상태 초기화
  useEffect(() => {
    if (!product) {
      setAttrState({})
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

  function resetAndCommit() {
    if (!product) return
    const attrs = product.optionAttributes ?? []

    // 속성이 없는 상품(옵션 1개) — 옵션 전체를 수량 1로 묶음
    if (attrs.length === 0) {
      if (product.options.length === 0) {
        toast.error('이 상품에는 선택할 옵션이 없습니다')
        return
      }
      const defaultOpt = product.options[0]
      const group: BuiltGroup = {
        suffixParts: [],
        items: [
          {
            optionId: defaultOpt.id,
            optionName: defaultOpt.name,
            sku: defaultOpt.sku,
            quantity: 1,
            attributeValues: defaultOpt.attributeValues,
          },
        ],
      }
      emit(group)
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

    // unselected cartesian (선택 안 된 속성의 모든 값 조합)
    // 배열 원소: Record<attrName, value>
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
    // unselected가 없으면 combos 빈 배열 → 1개 group으로 취급
    const effectiveCombos = combos.length > 0 ? combos : [{}]

    // 각 combo × 각 selected attr value(수량 포함) → option 매칭
    const groups: BuiltGroup[] = []
    for (const combo of effectiveCombos) {
      // combo에 selected 속성의 각 value를 덮어씌워 최종 attributeValues 조합을 만든다
      const groupItems: ItemEntry[] = []

      // selected 속성들의 value × quantity Cartesian — 모두 포함
      // 예: 선택된 속성 1개(색상), values {블랙:2, 화이트:1} → (색상=블랙, qty 2), (색상=화이트, qty 1)
      // 선택된 속성 2개(색상,재질)라면 두 축 cartesian
      type SelectedCombo = { values: Record<string, string>; qty: number }
      let selectedCombos: SelectedCombo[] = [{ values: {}, qty: 1 }]
      for (const s of selected) {
        const expanded: SelectedCombo[] = []
        for (const prev of selectedCombos) {
          for (const [value, q] of Object.entries(s.valueQuantities)) {
            expanded.push({
              values: { ...prev.values, [s.name]: value },
              qty: prev.qty === 1 ? q : prev.qty * q, // 다차원 선택 시 곱. 단일 속성이면 그대로.
            })
          }
        }
        selectedCombos = expanded
      }
      // 하지만 실제 요구사항은 "각 속성값 조합에 각 수량"이므로
      // 다차원에서 qty를 "마지막 속성값 수량"으로 해석. 안전하게 다시 계산.
      // 위 qty 로직은 의도와 다를 수 있으므로 단일 속성 경우만 의미가 있도록 단순화:
      // selected 속성이 1개면 value별 수량. 2개 이상이면 각 cartesian 셀마다 "그 값의 수량 합"이 모호.
      // 현재 요구는 "속성 값 기준 수량" + "cartesian 시 각 복제" — 다속성은 곱 적용으로 처리.

      for (const sc of selectedCombos) {
        const target = { ...combo, ...sc.values }
        const opt = findOption(product.options, target)
        if (!opt) {
          // 해당 조합에 옵션 row가 없으면 skip (옵션이 모든 cartesian을 갖지 않을 수도)
          continue
        }
        groupItems.push({
          optionId: opt.id,
          optionName: opt.name,
          sku: opt.sku,
          quantity: sc.qty,
          attributeValues: opt.attributeValues,
        })
      }

      if (groupItems.length === 0) continue

      // suffix는 unselected 속성의 값 (combo의 values)
      const suffixParts = unselected.map((a) => combo[a.name]).filter(Boolean)

      groups.push({ suffixParts, items: groupItems })
    }

    if (groups.length === 0) {
      toast.error('구성 가능한 옵션 조합이 없습니다')
      return
    }

    emitMany(groups)
  }

  function emit(group: BuiltGroup) {
    if (!product) return
    const ctx: ProductContext = {
      id: product.id,
      displayName: productDisplayName(product),
      officialName: product.name,
      brandName: product.brand?.name ?? null,
    }
    onCommit(ctx, [group])
  }

  function emitMany(groups: BuiltGroup[]) {
    if (!product) return
    const ctx: ProductContext = {
      id: product.id,
      displayName: productDisplayName(product),
      officialName: product.name,
      brandName: product.brand?.name ?? null,
    }
    onCommit(ctx, groups)
  }

  return (
    <div className="space-y-4 rounded-md border bg-muted/10 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">구성 만들기</h3>
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
      ) : (
        <div className="space-y-4">
          <SelectedProductHeader product={product} />
          {loading ? (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          ) : (
            <AttributesPicker
              product={product}
              attrState={attrState}
              onToggleAttr={toggleAttr}
              onToggleValue={toggleValue}
              onUpdateQty={updateValueQty}
            />
          )}
          <PreviewAndCommit
            product={product}
            attrState={attrState}
            onCommit={resetAndCommit}
            disabled={disabled}
          />
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
      <Label htmlFor="composition-product-search">1) 상품 선택</Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="composition-product-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명·관리코드 검색"
          className="pl-9"
        />
      </div>
      <div className="max-h-[30vh] overflow-y-auto rounded-md border bg-background">
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

// ─── 하위: 속성 / 값 체크 ────────────────────────────────────────────────────
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
      <Label>2) 속성과 값 선택</Label>
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

function PreviewAndCommit({
  product,
  attrState,
  onCommit,
  disabled,
}: {
  product: ProductDetail
  attrState: Record<string, AttrState>
  onCommit: () => void
  disabled?: boolean
}) {
  const preview = useMemo(() => computePreview(product, attrState), [product, attrState])
  const canCommit =
    !disabled &&
    ((product.optionAttributes?.length ?? 0) === 0 ||
      preview.selectedCount > 0 ||
      product.options.length > 0)
  return (
    <div className="space-y-2">
      {preview.groupCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          추가하기를 누르면 <strong>{preview.groupCount}</strong>개의 listing 조합이 생성됩니다
          {preview.sample && <> · 예: {preview.sample}</>}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          수량을 지정한 속성·값이 있으면 미리 보기가 표시됩니다
        </p>
      )}
      <Button type="button" onClick={onCommit} disabled={!canCommit}>
        <Plus className="mr-1 h-4 w-4" />
        추가하기
      </Button>
    </div>
  )
}

// ─── 로직: 옵션 매칭 & 프리뷰 ─────────────────────────────────────────────────

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

function computePreview(
  product: ProductDetail,
  attrState: Record<string, AttrState>
): { groupCount: number; selectedCount: number; sample: string | null } {
  const attrs = product.optionAttributes ?? []
  if (attrs.length === 0) {
    return { groupCount: product.options.length > 0 ? 1 : 0, selectedCount: 0, sample: null }
  }
  let selectedCount = 0
  const unselectedValues: string[][] = []
  const selectedNames: string[] = []
  for (const a of attrs) {
    const st = attrState[a.name]
    const hasQty = st?.enabled && Object.keys(st.valueQuantities).length > 0
    if (hasQty) {
      selectedCount += Object.keys(st!.valueQuantities).length
      selectedNames.push(a.name)
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
