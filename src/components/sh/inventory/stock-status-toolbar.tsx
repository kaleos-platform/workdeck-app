'use client'

import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  q: string
  onlyLow: boolean
  onSearchChange: (q: string) => void
  onOnlyLowChange: (v: boolean) => void
  onClearFilters: () => void
}

export function StockStatusToolbar({
  q,
  onlyLow,
  onSearchChange,
  onOnlyLowChange,
  onClearFilters,
}: Props) {
  const [prevQ, setPrevQ] = useState(q)
  const [local, setLocal] = useState(q)

  if (q !== prevQ) {
    setPrevQ(q)
    setLocal(q)
  }

  useEffect(() => {
    if (local === q) return
    const timer = setTimeout(() => {
      onSearchChange(local)
    }, 300)
    return () => clearTimeout(timer)
  }, [local, onSearchChange, q])

  const hasFilters = !!(onlyLow || q)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          placeholder="옵션/SKU 검색"
          className="h-9 w-72 pl-8"
        />
      </div>

      <div className="flex items-center gap-2">
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
    </div>
  )
}
