'use client'

import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { StockLocation } from './stock-status.types'

type Props = {
  locations: StockLocation[]
  hiddenLocationIds: string[]
  onToggleLocation: (locationId: string) => void
  onShowAll: () => void
}

/**
 * 표에 그릴 위치 컬럼 선택. 위치가 많으면 표가 가로로 넘치므로 안 보는 창고를 끌 수 있게 한다.
 * 숨김은 화면에만 적용된다 — 합계·등급·엑셀 다운로드는 전 위치 기준을 유지한다.
 */
export function StockStatusLocationPicker({
  locations,
  hiddenLocationIds,
  onToggleLocation,
  onShowAll,
}: Props) {
  if (locations.length <= 1) return null

  const hidden = new Set(hiddenLocationIds)
  const visibleCount = locations.filter((l) => !hidden.has(l.id)).length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          위치 {visibleCount}/{locations.length}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          표시할 위치 — 화면에만 적용됩니다
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {locations.map((location) => {
          const checked = !hidden.has(location.id)
          // 마지막 하나까지 끄면 위치 컬럼이 없는 표가 된다 — 해제 불가.
          const isLastVisible = checked && visibleCount === 1
          return (
            <DropdownMenuCheckboxItem
              key={location.id}
              checked={checked}
              disabled={isLastVisible}
              onCheckedChange={() => onToggleLocation(location.id)}
              onSelect={(event) => event.preventDefault()}
            >
              {location.name}
            </DropdownMenuCheckboxItem>
          )
        })}
        {visibleCount < locations.length && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowAll}>전체 표시</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
