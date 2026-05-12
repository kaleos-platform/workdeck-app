'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { StockBrand } from './stock-status.types'

type Props = {
  q: string
  onlyLow: boolean
  brands: StockBrand[]
  selectedBrandId: string | null
  selectedGroupId: string | null
  onSearchChange: (q: string) => void
  onOnlyLowChange: (v: boolean) => void
  onBrandChange: (brandId: string | null) => void
  onGroupChange: (groupId: string | null) => void
  onClearFilters: () => void
}

const ALL = '__all__'
const NONE = '__none__' // 브랜드 없음

export function StockStatusToolbar(props: Props) {
  // q prop이 외부에서 바뀌면 input을 재마운트해 동기화 (setState in effect 회피)
  return <ToolbarInner key={props.q} initialQ={props.q} {...props} />
}

function ToolbarInner({
  initialQ,
  q,
  onlyLow,
  brands,
  selectedBrandId,
  selectedGroupId,
  onSearchChange,
  onOnlyLowChange,
  onBrandChange,
  onGroupChange,
  onClearFilters,
}: Props & { initialQ: string }) {
  const [local, setLocal] = useState(initialQ)

  // debounce 300ms — local이 currentQ와 다를 때만 push
  useEffect(() => {
    if (local === q) return
    const t = setTimeout(() => {
      onSearchChange(local)
    }, 300)
    return () => clearTimeout(t)
  }, [local, q, onSearchChange])

  // 선택된 브랜드에 속한 그룹 목록 — '전체 브랜드'일 땐 모든 그룹 dedupe
  const groupOptions = useMemo(() => {
    if (selectedBrandId === null) {
      // 모든 브랜드의 그룹을 그룹 id 기준 dedupe
      const seen = new Map<string, { id: string; name: string }>()
      for (const b of brands) {
        for (const g of b.groups) if (!seen.has(g.id)) seen.set(g.id, { id: g.id, name: g.name })
      }
      return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
    }
    if (selectedBrandId === NONE) {
      const noneBrand = brands.find((b) => b.id === null)
      return noneBrand ? noneBrand.groups.map((g) => ({ id: g.id, name: g.name })) : []
    }
    const brand = brands.find((b) => b.id === selectedBrandId)
    return brand ? brand.groups.map((g) => ({ id: g.id, name: g.name })) : []
  }, [brands, selectedBrandId])

  const brandSelectValue =
    selectedBrandId === null ? ALL : selectedBrandId === '' ? NONE : selectedBrandId
  const groupSelectValue = selectedGroupId ?? ALL

  const hasFilters = !!(selectedBrandId !== null || selectedGroupId !== null || onlyLow || q)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="상품명 검색"
          className="h-9 w-64 pl-8"
        />
      </div>

      <Select value={brandSelectValue} onValueChange={(v) => onBrandChange(v === ALL ? null : v)}>
        <SelectTrigger className="h-9 w-44" aria-label="브랜드 필터">
          <SelectValue placeholder="전체 브랜드" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>전체 브랜드</SelectItem>
          {brands
            .filter((b) => b.id !== null)
            .map((b) => (
              <SelectItem key={b.id!} value={b.id!}>
                {b.name}
              </SelectItem>
            ))}
          {brands.some((b) => b.id === null) && <SelectItem value={NONE}>브랜드 없음</SelectItem>}
        </SelectContent>
      </Select>

      <Select value={groupSelectValue} onValueChange={(v) => onGroupChange(v === ALL ? null : v)}>
        <SelectTrigger className="h-9 w-44" aria-label="카테고리 필터">
          <SelectValue placeholder="전체 카테고리" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>전체 카테고리</SelectItem>
          {groupOptions.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        variant={onlyLow ? 'default' : 'outline'}
        onClick={() => onOnlyLowChange(!onlyLow)}
      >
        부족·결품만
      </Button>

      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={onClearFilters}>
          <X className="mr-1 h-3.5 w-3.5" />
          필터 초기화
        </Button>
      )}
    </div>
  )
}
