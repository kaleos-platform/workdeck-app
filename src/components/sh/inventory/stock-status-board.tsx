'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProductStockCard } from './product-stock-card'

const ALL = '__all__'

type Location = { id: string; name: string }
type StockByLocation = { locationId: string; locationName: string; quantity: number }
type Option = {
  optionId: string
  optionName: string
  sku: string | null
  stockByLocation: StockByLocation[]
  totalStock: number
  outbound7d: number
}
type Product = {
  productId: string
  productName: string
  productCode: string | null
  options: Option[]
}
type Group = {
  groupId: string
  groupName: string
  products: Product[]
}
type BoardData = {
  groups: Group[]
  locations: Location[]
}

export function StockStatusBoard() {
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeLocation, setActiveLocation] = useState(ALL)
  const [groupFilter, setGroupFilter] = useState(ALL)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sh/inventory/stock-status')
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // 검색 debounce 300ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  // 클라이언트 측 필터링
  const filteredGroups = (() => {
    if (!data) return []
    return data.groups
      .filter((g) => groupFilter === ALL || g.groupId === groupFilter)
      .map((g) => ({
        ...g,
        products: g.products.filter(
          (p) =>
            debouncedSearch === '' ||
            p.productName.toLowerCase().includes(debouncedSearch.toLowerCase())
        ),
      }))
      .filter((g) => g.products.length > 0)
  })()

  if (loading && !data) {
    return <div className="py-12 text-center text-sm text-muted-foreground">불러오는 중...</div>
  }

  const locations = data?.locations ?? []
  const groups = data?.groups ?? []

  return (
    <div className="space-y-6">
      {/* 위치 탭 */}
      <Tabs value={activeLocation} onValueChange={setActiveLocation}>
        <TabsList className="h-auto flex-wrap gap-1">
          <TabsTrigger value={ALL}>전체</TabsTrigger>
          {locations.map((loc) => (
            <TabsTrigger key={loc.id} value={loc.id}>
              {loc.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 그룹" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 그룹</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.groupId} value={g.groupId}>
                {g.groupName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="상품명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {/* 그룹 섹션 */}
      {filteredGroups.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          조건에 맞는 상품이 없습니다
        </div>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => (
            <section key={group.groupId}>
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-lg font-semibold">{group.groupName}</h2>
                <Badge variant="secondary">{group.products.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.products.map((product) => (
                  <ProductStockCard
                    key={product.productId}
                    product={product}
                    activeLocationId={activeLocation}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
