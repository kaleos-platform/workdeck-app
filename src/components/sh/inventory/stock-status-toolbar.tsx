'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Props = {
  q: string
  onlyLow: boolean
  selectedBrandName: string | null
  selectedGroupName: string | null
  onSearchChange: (q: string) => void
  onOnlyLowChange: (v: boolean) => void
  onClearFilters: () => void
}

export function StockStatusToolbar({
  q,
  onlyLow,
  selectedBrandName,
  selectedGroupName,
  onSearchChange,
  onOnlyLowChange,
  onClearFilters,
}: Props) {
  // q prop이 외부에서 바뀌면 input value도 따라간다 (필터 클리어 등).
  // key를 q로 바꿔 input을 재마운트해서 setState in effect를 피한다.
  return (
    <ToolbarInner
      key={q}
      initialQ={q}
      currentQ={q}
      onlyLow={onlyLow}
      selectedBrandName={selectedBrandName}
      selectedGroupName={selectedGroupName}
      onSearchChange={onSearchChange}
      onOnlyLowChange={onOnlyLowChange}
      onClearFilters={onClearFilters}
    />
  )
}

function ToolbarInner({
  initialQ,
  currentQ,
  onlyLow,
  selectedBrandName,
  selectedGroupName,
  onSearchChange,
  onOnlyLowChange,
  onClearFilters,
}: Omit<Props, 'q'> & { initialQ: string; currentQ: string }) {
  const [local, setLocal] = useState(initialQ)

  // debounce 300ms — local이 currentQ와 다를 때만 push
  useEffect(() => {
    if (local === currentQ) return
    const t = setTimeout(() => {
      onSearchChange(local)
    }, 300)
    return () => clearTimeout(t)
  }, [local, currentQ, onSearchChange])

  const hasFilters = !!(selectedBrandName || selectedGroupName || onlyLow || currentQ)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="SKU, 상품명 검색"
          className="h-9 w-64 pl-8"
        />
      </div>
      <Button
        size="sm"
        variant={onlyLow ? 'default' : 'outline'}
        onClick={() => onOnlyLowChange(!onlyLow)}
      >
        부족·결품만
      </Button>
      {selectedBrandName && (
        <Badge variant="secondary" className="gap-1">
          브랜드 · {selectedBrandName}
        </Badge>
      )}
      {selectedGroupName && (
        <Badge variant="secondary" className="gap-1">
          카테고리 · {selectedGroupName}
        </Badge>
      )}
      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={onClearFilters}>
          <X className="mr-1 h-3.5 w-3.5" />
          필터 초기화
        </Button>
      )}
    </div>
  )
}
