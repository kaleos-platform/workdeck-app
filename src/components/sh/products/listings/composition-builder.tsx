'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, Plus, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { productDisplayName } from '@/lib/sh/product-display'
import {
  attributeValuesOf,
  buildBackedValueSet,
  buildSimpleCompositionGroups,
  cartesianFromAttrState,
  diagnoseComposition,
  findMatchingOption,
} from './composition-builder-utils'

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

type AttributeDef = { name: string; values: Array<{ value: string; code?: string } | string> }

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
  /** manual 모드에서만 설정. bulk 모드는 undefined. */
  manualNames?: {
    searchName?: string
    displayName?: string
    managementName?: string
    internalCode?: string
  }
}

export type ProductContext = {
  id: string
  displayName: string
  officialName: string
  brandName: string | null
}

/** 최상위 모드: bulk = 기존 단일 상품 옵션 펼치기, manual = 여러 옵션 직접 묶기 */
type TopLevelMode = 'bulk' | 'manual'

/** manual 모드의 행 하나 */
type ManualRow = {
  id: string
  searchName: string
  displayName: string
  managementName: string
  internalCode: string
  items: ItemEntry[]
}

type Props = {
  onCommit: (product: ProductContext | null, groups: BuiltGroup[]) => void
  disabled?: boolean
  /** 최초 진입 모드. 기본값 'bulk' */
  initialMode?: TopLevelMode
}

export function CompositionBuilder({ onCommit, disabled, initialMode = 'bulk' }: Props) {
  // 최상위 모드 토글: bulk(기존) vs manual(새)
  const [topMode, setTopMode] = useState<TopLevelMode>(initialMode)

  // ── bulk 모드 상태 ──────────────────────────────────────────────
  const [product, setProduct] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<BuilderMode>('simple')

  // simple 모드
  const [setQuantities, setSetQuantities] = useState<number[]>([1])

  // advanced 모드
  const [attrState, setAttrState] = useState<Record<string, AttrState>>({})
  const [bundles, setBundles] = useState<Bundle[]>([{ id: 'b1', valueQuantities: {} }])

  // ── manual 모드 상태 ────────────────────────────────────────────
  const [manualRows, setManualRows] = useState<ManualRow[]>([])

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
    if (topMode === 'manual') {
      commitManual()
      return
    }
    if (!product) return
    if (mode === 'simple') commitSimple()
    else commitAdvanced()
  }

  function commitManual() {
    const validRows = manualRows.filter((r) => r.items.length > 0)
    if (validRows.length === 0) {
      toast.error('옵션 구성이 없습니다. 각 행에 옵션을 추가하세요')
      return
    }
    const groups: BuiltGroup[] = validRows.map((r) => ({
      suffixParts: [],
      items: r.items,
      manualNames: {
        searchName: r.searchName.trim() || undefined,
        displayName: r.displayName.trim() || undefined,
        managementName: r.managementName.trim() || undefined,
        internalCode: r.internalCode.trim() || undefined,
      },
    }))
    // manual 모드는 ProductContext 없이 null로 커밋
    onCommit(null, groups)
  }

  function commitSimple() {
    if (!product) return
    const groups = buildSimpleCompositionGroups({ product, attrState, setQuantities })
    if (groups.length === 0) {
      const attrs = product.optionAttributes ?? []
      const diag = diagnoseComposition(product, cartesianFromAttrState(attrs, attrState))
      toast.error(
        diag.message || '생성 가능한 옵션 조합이 없습니다. 상품 옵션의 속성값을 확인해 주세요'
      )
      return
    }
    // PARTIAL — 일부 조합만 backed: backed 조합으로 진행하되 누락을 경고
    const diag = diagnoseComposition(
      product,
      cartesianFromAttrState(product.optionAttributes ?? [], attrState)
    )
    if (diag.caseType === 'PARTIAL') {
      toast.warning(diag.message)
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
      const vals = attributeValuesOf(attr)
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
          const opt = findMatchingOption(product.options, target)
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
      // 수량 지정 속성의 선택값 + 미선택 속성 전체값으로 조합을 구성해 진단
      const advCombos = cartesianFromAttrState(
        attrs,
        attrs.reduce<Record<string, AttrState>>((acc, attr) => {
          const picked = new Set<string>()
          for (const b of bundles) {
            for (const v of Object.keys(b.valueQuantities[attr.name] ?? {})) picked.add(v)
          }
          acc[attr.name] =
            picked.size > 0
              ? {
                  enabled: true,
                  valueQuantities: Object.fromEntries([...picked].map((v) => [v, 1])),
                }
              : { enabled: false, valueQuantities: {} }
          return acc
        }, {})
      )
      const diag = diagnoseComposition(product, advCombos)
      toast.error(diag.message || '구성 가능한 옵션 조합이 없습니다')
      return
    }
    emit(groups)
  }

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
      {/* 최상위 모드 토글 */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">구성 방식</Label>
        <Tabs value={topMode} onValueChange={(v) => setTopMode(v as TopLevelMode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="bulk">한 상품의 옵션 펼치기</TabsTrigger>
            <TabsTrigger value="manual">여러 옵션 직접 묶기</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {topMode === 'manual' ? (
        /* ── manual 모드 ── */
        <ManualModeEditor
          rows={manualRows}
          onRowsChange={setManualRows}
          disabled={disabled}
          onCommit={handleCommit}
        />
      ) : (
        /* ── bulk 모드 (기존) ── */
        <>
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
                        setSetQuantities((prev) =>
                          prev.map((x, i) => (i === idx ? Math.max(1, q) : x))
                        )
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
        </>
      )}
    </div>
  )
}

// ─── manual 모드 에디터 ───────────────────────────────────────────────────────
function ManualModeEditor({
  rows,
  onRowsChange,
  disabled,
  onCommit,
}: {
  rows: ManualRow[]
  onRowsChange: (next: ManualRow[]) => void
  disabled?: boolean
  onCommit: () => void
}) {
  function addRow() {
    onRowsChange([
      ...rows,
      {
        id: `m-${Date.now()}-${rows.length}`,
        searchName: '',
        displayName: '',
        managementName: '',
        internalCode: '',
        items: [],
      },
    ])
  }

  function removeRow(id: string) {
    onRowsChange(rows.filter((r) => r.id !== id))
  }

  function updateRow(id: string, patch: Partial<Omit<ManualRow, 'id'>>) {
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        각 행이 판매 옵션 1개가 됩니다. 행마다 여러 상품의 옵션을 섞어 구성할 수 있습니다. 이름을
        비우면 생성 시 검색명을 그대로 사용합니다.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          아래 버튼으로 행을 추가하세요
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row, idx) => (
            <ManualRowEditor
              key={row.id}
              row={row}
              index={idx}
              onUpdate={(patch) => updateRow(row.id, patch)}
              onRemove={() => removeRow(row.id)}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={disabled}>
          <Plus className="mr-1 h-4 w-4" />행 추가
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={disabled || rows.filter((r) => r.items.length > 0).length === 0}
        >
          <Plus className="mr-1 h-4 w-4" />
          추가하기
        </Button>
      </div>
    </div>
  )
}

function ManualRowEditor({
  row,
  index,
  onUpdate,
  onRemove,
  disabled,
}: {
  row: ManualRow
  index: number
  onUpdate: (patch: Partial<Omit<ManualRow, 'id'>>) => void
  onRemove: () => void
  disabled?: boolean
}) {
  const [optionPickerOpen, setOptionPickerOpen] = useState(false)
  const [optionQuery, setOptionQuery] = useState('')
  const [optionProduct, setOptionProduct] = useState<ProductDetail | null>(null)
  const [optionLoading, setOptionLoading] = useState(false)
  const [optionResults, setOptionResults] = useState<ProductRow[]>([])
  const [optionSearchDebounced, setOptionSearchDebounced] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setOptionSearchDebounced(optionQuery), 300)
    return () => clearTimeout(t)
  }, [optionQuery])

  useEffect(() => {
    if (!optionPickerOpen) return
    let cancelled = false
    const load = async () => {
      setOptionLoading(true)
      try {
        const qs = new URLSearchParams()
        qs.set('pageSize', '20')
        if (optionSearchDebounced.trim()) qs.set('search', optionSearchDebounced.trim())
        const res = await fetch(`/api/sh/products?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data?: ProductRow[]; products?: ProductRow[] } = await res.json()
        if (!cancelled) setOptionResults(data.data ?? data.products ?? [])
      } catch {
        // 검색 실패는 조용히 처리
      } finally {
        if (!cancelled) setOptionLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [optionSearchDebounced, optionPickerOpen])

  async function pickOptionProduct(p: ProductRow) {
    setOptionLoading(true)
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
      setOptionProduct({
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
      setOptionLoading(false)
    }
  }

  function addOptionToRow(opt: OptionRow) {
    const newItem: ItemEntry = {
      optionId: opt.id,
      optionName: opt.name,
      sku: opt.sku,
      quantity: 1,
      retailPrice: opt.retailPrice,
      attributeValues: opt.attributeValues,
    }
    onUpdate({ items: [...row.items, newItem] })
    setOptionPickerOpen(false)
    setOptionProduct(null)
    setOptionQuery('')
  }

  function updateItemQty(optionId: string, qty: number) {
    onUpdate({
      items: row.items.map((it) =>
        it.optionId === optionId ? { ...it, quantity: Math.max(1, qty) } : it
      ),
    })
  }

  function removeItem(optionId: string) {
    onUpdate({ items: row.items.filter((it) => it.optionId !== optionId) })
  }

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">옵션 행 #{index + 1}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          disabled={disabled}
          aria-label="행 제거"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 이름 입력 필드 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">검색명</Label>
          <Input
            value={row.searchName}
            onChange={(e) => onUpdate({ searchName: e.target.value })}
            placeholder="(기본 검색명 사용)"
            className="h-8 text-sm"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">노출명</Label>
          <Input
            value={row.displayName}
            onChange={(e) => onUpdate({ displayName: e.target.value })}
            placeholder="(검색명과 동일)"
            className="h-8 text-sm"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">관리명</Label>
          <Input
            value={row.managementName}
            onChange={(e) => onUpdate({ managementName: e.target.value })}
            placeholder="(선택)"
            className="h-8 text-sm"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">관리 코드</Label>
          <Input
            value={row.internalCode}
            onChange={(e) => onUpdate({ internalCode: e.target.value })}
            placeholder="(선택)"
            className="h-8 text-sm"
            disabled={disabled}
          />
        </div>
      </div>

      {/* 포함 옵션 목록 */}
      {row.items.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">포함 옵션</p>
          <div className="space-y-1">
            {row.items.map((it) => (
              <div
                key={it.optionId}
                className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5"
              >
                <span className="flex-1 text-xs">{it.optionName}</span>
                <span className="text-xs text-muted-foreground">수량</span>
                <Input
                  type="number"
                  min={1}
                  max={999}
                  value={it.quantity}
                  onChange={(e) => updateItemQty(it.optionId, Number(e.target.value || 1))}
                  className="h-6 w-16 text-xs"
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeItem(it.optionId)}
                  disabled={disabled}
                  aria-label="옵션 제거"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 옵션 추가 버튼 / picker */}
      {!optionPickerOpen ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setOptionPickerOpen(true)}
          disabled={disabled}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          옵션 추가
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/20 p-2">
          {!optionProduct ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">상품 검색</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => {
                    setOptionPickerOpen(false)
                    setOptionQuery('')
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={optionQuery}
                  onChange={(e) => setOptionQuery(e.target.value)}
                  placeholder="상품명·관리코드"
                  className="h-8 pl-8 text-sm"
                  autoFocus
                />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border bg-background">
                {optionLoading ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">검색 중...</div>
                ) : optionResults.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    {optionQuery ? '결과 없음' : '검색어를 입력하세요'}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {optionResults.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => pickOptionProduct(p)}
                          className="w-full px-3 py-2 text-left text-xs hover:bg-muted/60"
                        >
                          <span className="font-medium">{productDisplayName(p)}</span>
                          {p.brand?.name && (
                            <span className="ml-1 text-muted-foreground">· {p.brand.name}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs">
                    {productDisplayName(optionProduct)}
                  </Badge>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setOptionProduct(null)}
                >
                  <ChevronLeft className="mr-1 h-3 w-3" />
                  상품 변경
                </Button>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border bg-background">
                {optionLoading ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    불러오는 중...
                  </div>
                ) : optionProduct.options.length === 0 ? (
                  <div className="p-3 text-center text-xs text-muted-foreground">
                    옵션이 없습니다
                  </div>
                ) : (
                  <ul className="divide-y">
                    {optionProduct.options.map((opt) => {
                      const alreadyAdded = row.items.some((it) => it.optionId === opt.id)
                      return (
                        <li key={opt.id}>
                          <button
                            type="button"
                            onClick={() => !alreadyAdded && addOptionToRow(opt)}
                            disabled={alreadyAdded}
                            className={`w-full px-3 py-2 text-left text-xs transition ${
                              alreadyAdded ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted/60'
                            }`}
                          >
                            <span className="font-medium">{opt.name}</span>
                            {alreadyAdded && (
                              <span className="ml-1 text-muted-foreground">(이미 추가됨)</span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
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
  const attrs = useMemo(() => product.optionAttributes ?? [], [product.optionAttributes])
  const bundleCount = setQuantities.length

  // 정의 cartesian(전체 선택 조합) + 뒷받침 진단을 단일 source로 계산
  const allCombos = useMemo(
    () =>
      attrs.length === 0
        ? product.options.length > 0
          ? [{} as Record<string, string>]
          : []
        : cartesianFromAttrState(attrs, attrState),
    [attrs, attrState, product.options.length]
  )
  const diag = useMemo(() => diagnoseComposition(product, allCombos), [product, allCombos])
  // 옵션 행이 실제 보유한 (속성, 값) 집합 — 인라인 배지용
  const backedValueSet = useMemo(() => buildBackedValueSet(product.options), [product.options])

  const previewGroups = buildSimpleCompositionGroups({ product, attrState, setQuantities })
  const comboCount = diag.backedCombos.length
  const totalListings = previewGroups.length

  // 예시는 정의가 아니라 "뒷받침되는" 조합에서만 — false confidence 방지
  const samples = diag.backedCombos.slice(0, 3).map((c) =>
    attrs
      .map((a) => c[a.name])
      .filter(Boolean)
      .join(' / ')
  )

  return (
    <div className="space-y-3 rounded-md border bg-background p-3">
      {attrs.length > 0 && diag.caseType !== 'OK' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{diag.message}</span>
        </div>
      )}
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
                      {attributeValuesOf(attr).map((value) => {
                        const checked = state.valueQuantities[value] !== undefined
                        const unbacked = !backedValueSet.has(`${attr.name.trim()} ${value}`)
                        return (
                          <label
                            key={value}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                              checked ? 'border-primary bg-primary/10' : 'hover:bg-muted'
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => onToggleValue(attr.name, value, c === true)}
                            />
                            <span>{value}</span>
                            {unbacked && (
                              <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                옵션 없음
                              </span>
                            )}
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
  const backedValueSet = buildBackedValueSet(product.options)
  const advDiag = diagnoseComposition(product, cartesianFromAttrState(attrs, attrState))
  return (
    <div className="space-y-4">
      {advDiag.caseType !== 'OK' && advDiag.caseType !== 'PARTIAL' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{advDiag.message}</span>
        </div>
      )}
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
                          {attributeValuesOf(attr).map((value) => {
                            const checked = value in valueMap
                            const unbacked = !backedValueSet.has(`${attr.name.trim()} ${value}`)
                            return (
                              <div key={value} className="flex items-center gap-2">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(on) =>
                                    onToggleBundleValue(bundle.id, attr.name, value, on === true)
                                  }
                                />
                                <span className="min-w-[80px] text-sm">{value}</span>
                                {unbacked && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    옵션 없음
                                  </span>
                                )}
                                {checked && (
                                  <>
                                    <span className="text-xs text-muted-foreground">수량</span>
                                    <Input
                                      type="number"
                                      min={1}
                                      max={999}
                                      value={valueMap[value] ?? 1}
                                      onChange={(e) =>
                                        onUpdateBundleValueQty(
                                          bundle.id,
                                          attr.name,
                                          value,
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
      unselectedValues.push({ name: a.name, values: attributeValuesOf(a) })
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
