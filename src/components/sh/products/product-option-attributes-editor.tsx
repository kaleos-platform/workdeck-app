'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  aliasMapKey,
  generateOptionSku,
  resolveValueCode,
  type AttrCodeSpec,
} from '@/lib/sh/option-code'

const MAX_ATTRIBUTES = 3

/** 속성 값 — 값(사용자 입력) + 코드(자동 또는 수동) */
export type OptionAttributeValue = { value: string; code: string }

/** 속성 하나 (예: { name: "사이즈", values: [{value:"S",code:"S"}, ...] }) */
export type OptionAttribute = {
  name: string
  values: OptionAttributeValue[]
}

/** 조합 행 하나 */
export type CombinationRow = {
  /** 각 속성의 값 (속성 순서 기준) */
  combination: string[]
  /** 관리코드 — 자동 or 수동 */
  sku: string
  /** 사용자가 직접 수정했는지 (true면 자동 재계산에서 제외) */
  skuManual: boolean
  costPrice: string
  retailPrice: string
}

type Props = {
  attributes: OptionAttribute[]
  combinations: CombinationRow[]
  onAttributesChange: (attrs: OptionAttribute[]) => void
  onCombinationsChange: (rows: CombinationRow[]) => void
  /** SKU 자동 조립에 사용할 상품 코드 (없으면 속성 코드만 조립) */
  productCode?: string | null
  /** 조합 프리뷰 테이블 렌더 여부. 기본 true(상품 등록용); 상세에서는 false로 옵션 테이블이 대체. */
  showCombinationsPreview?: boolean
}

function cartesian(arrays: string[][]): string[][] {
  if (arrays.length === 0) return []
  return arrays.reduce<string[][]>(
    (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
    [[]]
  )
}

function combinationLabel(comb: string[]): string {
  return comb.join(' / ')
}

/**
 * 한 조합의 SKU를 자동 계산한다.
 * 속성별 값 → 해당 값의 코드 조회 → 긴 코드 앞 정렬 규칙으로 조립.
 */
function computeSkuForCombination(params: {
  combination: string[]
  validAttrs: OptionAttribute[]
  productCode?: string | null
}): string {
  const specs: AttrCodeSpec[] = params.validAttrs.map((attr, attrIdx) => {
    const val = params.combination[attrIdx]
    const match = attr.values.find((v) => v.value === val)
    const code = match?.code?.trim() ?? ''
    const maxLen = Math.max(0, ...attr.values.map((v) => v.code?.length ?? 0))
    return { attrIdx, code, maxLen }
  })
  return generateOptionSku({ productCode: params.productCode, attributeCodes: specs })
}

/**
 * 옵션 속성 에디터.
 * - 속성 최대 3개
 * - 각 값에 자동 코드 생성(Space alias 우선 → 시스템 규칙) + 수동 수정 가능
 * - 조합 자동 생성 + SKU 자동 조립(수동 수정 시 skuManual=true로 보존)
 */
export function ProductOptionAttributesEditor({
  attributes,
  combinations,
  onAttributesChange,
  onCombinationsChange,
  productCode,
  showCombinationsPreview = true,
}: Props) {
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({})
  const [aliasMap, setAliasMap] = useState<Map<string, string> | null>(null)

  // Space alias prefetch (1회)
  useEffect(() => {
    let cancelled = false
    fetch('/api/sh/option-code-aliases')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.data) return
        const map = new Map<string, string>()
        for (const entry of data.data as Array<{
          attributeName: string
          value: string
          code: string
        }>) {
          map.set(aliasMapKey(entry.attributeName, entry.value), entry.code)
        }
        setAliasMap(map)
      })
      .catch(() => {
        // alias 조회 실패해도 에디터는 정상 동작 (시스템 사전 폴백)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 유효 속성 (이름+값 있음)
  const validAttrs = useMemo(
    () => attributes.filter((a) => a.name.trim() && a.values.length > 0),
    [attributes]
  )

  // attributes 변경 시 조합 재계산 (sku/costPrice/retailPrice 보존)
  const attributesKey = useMemo(
    () =>
      attributes
        .map((a) => `${a.name}::${a.values.map((v) => `${v.value}|${v.code}`).join(',')}`)
        .join(';'),
    [attributes]
  )
  const prevAttrKeyRef = useRef<string>('')

  useEffect(() => {
    if (attributesKey === prevAttrKeyRef.current) return
    prevAttrKeyRef.current = attributesKey

    if (validAttrs.length === 0) {
      if (combinations.length > 0) onCombinationsChange([])
      return
    }

    const valueArrays = validAttrs.map((a) => a.values.map((v) => v.value))
    const newCombs = cartesian(valueArrays)
    const existingMap = new Map(combinations.map((r) => [r.combination.join('|'), r]))

    const newRows: CombinationRow[] = newCombs.map((comb) => {
      const key = comb.join('|')
      const existing = existingMap.get(key)
      const autoSku = computeSkuForCombination({
        combination: comb,
        validAttrs,
        productCode,
      })
      if (existing) {
        // sku가 수동 수정된 조합은 사용자 입력 유지, 아니면 재계산
        return {
          ...existing,
          combination: comb,
          sku: existing.skuManual ? existing.sku : autoSku,
        }
      }
      return {
        combination: comb,
        sku: autoSku,
        skuManual: false,
        costPrice: '',
        retailPrice: '',
      }
    })
    onCombinationsChange(newRows)
    // attributesKey 변경만 트리거. combinations는 양방향 의존을 피하기 위해 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributesKey, productCode])

  // productCode 변경 시 자동 sku 갱신 (skuManual=false인 것만)
  useEffect(() => {
    if (combinations.length === 0) return
    const updated = combinations.map((row) => {
      if (row.skuManual) return row
      const autoSku = computeSkuForCombination({
        combination: row.combination,
        validAttrs,
        productCode,
      })
      return row.sku === autoSku ? row : { ...row, sku: autoSku }
    })
    if (updated.some((r, i) => r !== combinations[i])) {
      onCombinationsChange(updated)
    }
    // productCode 변경만 트리거
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCode])

  const addAttribute = useCallback(() => {
    if (attributes.length >= MAX_ATTRIBUTES) return
    onAttributesChange([...attributes, { name: '', values: [] }])
  }, [attributes, onAttributesChange])

  const removeAttribute = useCallback(
    (idx: number) => {
      onAttributesChange(attributes.filter((_, i) => i !== idx))
      setValueInputs((prev) => {
        const next = { ...prev }
        delete next[idx]
        return next
      })
    },
    [attributes, onAttributesChange]
  )

  const updateAttributeName = useCallback(
    (idx: number, name: string) => {
      onAttributesChange(attributes.map((a, i) => (i === idx ? { ...a, name } : a)))
    },
    [attributes, onAttributesChange]
  )

  const addValue = useCallback(
    (attrIdx: number) => {
      const raw = (valueInputs[attrIdx] ?? '').trim()
      if (!raw) return
      const attr = attributes[attrIdx]
      if (attr.values.some((v) => v.value === raw)) return
      const code = resolveValueCode({
        attributeName: attr.name,
        value: raw,
        spaceAliasMap: aliasMap,
      })
      onAttributesChange(
        attributes.map((a, i) =>
          i === attrIdx ? { ...a, values: [...a.values, { value: raw, code }] } : a
        )
      )
      setValueInputs((prev) => ({ ...prev, [attrIdx]: '' }))
    },
    [valueInputs, attributes, aliasMap, onAttributesChange]
  )

  const removeValue = useCallback(
    (attrIdx: number, value: string) => {
      onAttributesChange(
        attributes.map((a, i) =>
          i === attrIdx ? { ...a, values: a.values.filter((v) => v.value !== value) } : a
        )
      )
    },
    [attributes, onAttributesChange]
  )

  const updateValueCode = useCallback(
    (attrIdx: number, valueIdx: number, code: string) => {
      // 대문자 + 영숫자만 + 3자 절삭
      const normalized = code
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 3)
      onAttributesChange(
        attributes.map((a, i) =>
          i === attrIdx
            ? {
                ...a,
                values: a.values.map((v, j) => (j === valueIdx ? { ...v, code: normalized } : v)),
              }
            : a
        )
      )
    },
    [attributes, onAttributesChange]
  )

  const updateCombination = useCallback(
    (rowIdx: number, field: 'sku' | 'costPrice' | 'retailPrice', value: string) => {
      onCombinationsChange(
        combinations.map((r, i) => {
          if (i !== rowIdx) return r
          if (field === 'sku') return { ...r, sku: value, skuManual: true }
          return { ...r, [field]: value }
        })
      )
    },
    [combinations, onCombinationsChange]
  )

  const hasAttributes = attributes.length > 0
  const hasCombinations = combinations.length > 0
  const canAddAttr = attributes.length < MAX_ATTRIBUTES
  const validAttrNames = validAttrs.map((a) => a.name)

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-semibold">옵션 속성 정의</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              최대 {MAX_ATTRIBUTES}개 속성. 값의 코드는 자동 제안되며 직접 수정 가능합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addAttribute}
            disabled={!canAddAttr}
            title={canAddAttr ? '속성 추가' : `최대 ${MAX_ATTRIBUTES}개까지 가능합니다`}
          >
            <Plus className="mr-1 h-3 w-3" />
            속성 추가 ({attributes.length}/{MAX_ATTRIBUTES})
          </Button>
        </div>

        {!hasAttributes && (
          <p className="text-xs text-muted-foreground">
            속성을 추가하면 자동으로 옵션 조합이 생성됩니다. (예: 사이즈 × 색상)
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {attributes.map((attr, attrIdx) => (
            <div key={attrIdx} className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={attr.name}
                  onChange={(e) => updateAttributeName(attrIdx, e.target.value)}
                  placeholder="속성명 (예: 사이즈)"
                  className="h-8 flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => removeAttribute(attrIdx)}
                  aria-label="속성 삭제"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-1">
                {attr.values.map((v, valueIdx) => (
                  <div key={`${v.value}-${valueIdx}`} className="flex items-center gap-1.5">
                    <Input value={v.value} readOnly className="h-7 flex-1 bg-background text-xs" />
                    <span className="text-[10px] text-muted-foreground">코드</span>
                    <Input
                      value={v.code}
                      onChange={(e) => updateValueCode(attrIdx, valueIdx, e.target.value)}
                      placeholder="자동"
                      className="h-7 w-14 text-xs uppercase"
                      maxLength={3}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeValue(attrIdx, v.value)}
                      aria-label={`${v.value} 제거`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 pt-1">
                  <Input
                    value={valueInputs[attrIdx] ?? ''}
                    onChange={(e) =>
                      setValueInputs((prev) => ({ ...prev, [attrIdx]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addValue(attrIdx)
                      }
                    }}
                    placeholder="값 입력 후 Enter (예: S, M, 누드)"
                    className="h-7 flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => addValue(attrIdx)}
                  >
                    <Plus className="h-3 w-3" />
                    추가
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {canAddAttr && (
            <button
              type="button"
              onClick={addAttribute}
              className="flex min-h-[140px] flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40 hover:text-foreground"
              aria-label="속성 추가"
            >
              <Plus className="h-4 w-4" />
              속성 추가 ({attributes.length}/{MAX_ATTRIBUTES})
            </button>
          )}
        </div>
      </div>

      {hasCombinations && showCombinationsPreview && (
        <div className="rounded-md border">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
            <p className="text-sm font-semibold">
              자동 생성 조합{' '}
              <span className="font-normal text-muted-foreground">({combinations.length}개)</span>
            </p>
            <p className="text-xs text-muted-foreground">
              관리코드는 자동 조립되며, 직접 수정하면 유지됩니다.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {validAttrNames.map((attrName) => (
                    <TableHead key={attrName} className="min-w-[80px] text-xs">
                      {attrName}
                    </TableHead>
                  ))}
                  <TableHead className="min-w-[140px] text-xs">관리코드 (SKU)</TableHead>
                  <TableHead className="min-w-[90px] text-xs">원가</TableHead>
                  <TableHead className="min-w-[90px] text-xs">소비자가</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {combinations.map((row, rowIdx) => (
                  <TableRow key={combinationLabel(row.combination)}>
                    {row.combination.map((val, valIdx) => (
                      <TableCell key={valIdx} className="py-1.5 text-sm font-medium">
                        {val}
                      </TableCell>
                    ))}
                    <TableCell className="py-1.5">
                      <Input
                        value={row.sku}
                        onChange={(e) => updateCombination(rowIdx, 'sku', e.target.value)}
                        placeholder="(자동)"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        type="number"
                        min="0"
                        value={row.costPrice}
                        onChange={(e) => updateCombination(rowIdx, 'costPrice', e.target.value)}
                        placeholder="0"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell className="py-1.5">
                      <Input
                        type="number"
                        min="0"
                        value={row.retailPrice}
                        onChange={(e) => updateCombination(rowIdx, 'retailPrice', e.target.value)}
                        placeholder="0"
                        className="h-7 text-xs"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
