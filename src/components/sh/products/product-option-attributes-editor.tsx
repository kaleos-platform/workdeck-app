'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** 속성 하나 (예: { name: "사이즈", values: ["S","M","L"] }) */
export type OptionAttribute = {
  name: string
  values: string[]
}

/** 조합 행 하나 (예: { combination: ["파랑","S"], sku: "", costPrice: "", retailPrice: "" }) */
export type CombinationRow = {
  /** 각 속성의 값 배열 (속성 순서 기준) */
  combination: string[]
  sku: string
  costPrice: string
  retailPrice: string
}

type Props = {
  /** 현재 속성 목록 */
  attributes: OptionAttribute[]
  /** 현재 조합 행 목록 */
  combinations: CombinationRow[]
  /** 속성 변경 시 호출 */
  onAttributesChange: (attrs: OptionAttribute[]) => void
  /** 조합 행 변경 시 호출 */
  onCombinationsChange: (rows: CombinationRow[]) => void
}

/** 카티션 곱 계산 */
function cartesian(arrays: string[][]): string[][] {
  if (arrays.length === 0) return []
  return arrays.reduce<string[][]>(
    (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
    [[]]
  )
}

/** 조합 배열을 표시명으로 변환 */
function combinationLabel(comb: string[]): string {
  return comb.join(' / ')
}

/**
 * 옵션 속성 정의 + 자동 조합 생성 에디터.
 * Controlled 컴포넌트 — 부모가 attributes/combinations 상태를 소유한다.
 */
export function ProductOptionAttributesEditor({
  attributes,
  combinations,
  onAttributesChange,
  onCombinationsChange,
}: Props) {
  // 값 입력 임시 상태 (속성 인덱스 → 현재 입력중인 값)
  const [valueInputs, setValueInputs] = useState<Record<number, string>>({})

  // 속성 변경 시 조합 재계산 (sku/costPrice/retailPrice는 기존 값 최대한 보존)
  useEffect(() => {
    const validAttrs = attributes.filter((a) => a.name.trim() && a.values.length > 0)
    if (validAttrs.length === 0) {
      onCombinationsChange([])
      return
    }
    const valueArrays = validAttrs.map((a) => a.values)
    const newCombs = cartesian(valueArrays)

    // 기존 조합 key → row 맵 (보존용)
    const existingMap = new Map(combinations.map((r) => [r.combination.join('|'), r]))

    const newRows: CombinationRow[] = newCombs.map((comb) => {
      const key = comb.join('|')
      const existing = existingMap.get(key)
      return existing ?? { combination: comb, sku: '', costPrice: '', retailPrice: '' }
    })
    onCombinationsChange(newRows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attributes])

  // 속성 추가
  function addAttribute() {
    onAttributesChange([...attributes, { name: '', values: [] }])
  }

  // 속성 제거
  function removeAttribute(idx: number) {
    onAttributesChange(attributes.filter((_, i) => i !== idx))
    setValueInputs((prev) => {
      const next = { ...prev }
      delete next[idx]
      return next
    })
  }

  // 속성명 변경
  function updateAttributeName(idx: number, value: string) {
    onAttributesChange(attributes.map((a, i) => (i === idx ? { ...a, name: value } : a)))
  }

  // 속성 값 추가
  function addValue(attrIdx: number) {
    const val = (valueInputs[attrIdx] ?? '').trim()
    if (!val) return
    const attr = attributes[attrIdx]
    if (attr.values.includes(val)) return
    onAttributesChange(
      attributes.map((a, i) => (i === attrIdx ? { ...a, values: [...a.values, val] } : a))
    )
    setValueInputs((prev) => ({ ...prev, [attrIdx]: '' }))
  }

  // 속성 값 제거
  function removeValue(attrIdx: number, val: string) {
    onAttributesChange(
      attributes.map((a, i) =>
        i === attrIdx ? { ...a, values: a.values.filter((v) => v !== val) } : a
      )
    )
  }

  // 조합 행 편집
  function updateCombination(
    rowIdx: number,
    field: 'sku' | 'costPrice' | 'retailPrice',
    value: string
  ) {
    onCombinationsChange(combinations.map((r, i) => (i === rowIdx ? { ...r, [field]: value } : r)))
  }

  const hasAttributes = attributes.length > 0
  const hasCombinations = combinations.length > 0

  // 유효한 속성 이름 목록 (테이블 헤더용)
  const validAttrNames = useMemo(
    () => attributes.filter((a) => a.name.trim()).map((a) => a.name),
    [attributes]
  )

  return (
    <div className="space-y-4">
      {/* 속성 정의 섹션 */}
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">옵션 속성 정의</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addAttribute}>
            <Plus className="mr-1 h-3 w-3" />
            속성 추가
          </Button>
        </div>

        {!hasAttributes && (
          <p className="text-xs text-muted-foreground">
            속성을 추가하면 자동으로 옵션 조합이 생성됩니다. (예: 사이즈 × 색상)
          </p>
        )}

        {attributes.map((attr, attrIdx) => (
          <div key={attrIdx} className="space-y-2">
            {/* 속성명 행 */}
            <div className="flex items-center gap-2">
              <Input
                value={attr.name}
                onChange={(e) => updateAttributeName(attrIdx, e.target.value)}
                placeholder="속성명 (예: 사이즈)"
                className="h-8 max-w-[180px]"
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

            {/* 값 태그 + 추가 입력 */}
            <div className="flex flex-wrap items-center gap-1.5 pl-1">
              {attr.values.map((val) => (
                <Badge key={val} variant="secondary" className="gap-1 pr-1">
                  {val}
                  <button
                    type="button"
                    onClick={() => removeValue(attrIdx, val)}
                    className="ml-0.5 rounded-sm hover:text-destructive"
                    aria-label={`${val} 제거`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <div className="flex items-center gap-1">
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
                  placeholder="값 입력 후 Enter"
                  className="h-7 w-28 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => addValue(attrIdx)}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 자동 생성 조합 테이블 */}
      {hasCombinations && (
        <div className="rounded-md border">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
            <p className="text-sm font-semibold">
              자동 생성 조합{' '}
              <span className="font-normal text-muted-foreground">({combinations.length}개)</span>
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
                  <TableHead className="min-w-[110px] text-xs">SKU</TableHead>
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
