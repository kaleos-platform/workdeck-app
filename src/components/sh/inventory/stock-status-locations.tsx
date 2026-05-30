'use client'

import { useState, useMemo } from 'react'
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LOCATION_TYPE_LABEL, type StockLocation } from './stock-status.types'

type Props = {
  locations: StockLocation[]
  loading: boolean
  onViewLocationDetail: (locationId: string) => void
}

const KRW = new Intl.NumberFormat('ko-KR')

// 위치 슬라이스 색상 팔레트 (최대 8색 순환)
const LOCATION_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
]

// 상품 드릴다운 색상 팔레트
const PRODUCT_COLORS = [
  '#a5b4fc',
  '#6ee7b7',
  '#fcd34d',
  '#93c5fd',
  '#f9a8d4',
  '#c4b5fd',
  '#5eead4',
  '#fdba74',
]

type PieEntry = {
  id: string
  name: string
  value: number
  type?: string
}

export function StockStatusLocations({ locations, loading, onViewLocationDetail }: Props) {
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)

  // 위치별 도넛 차트 데이터
  const locationPieData = useMemo<PieEntry[]>(
    () =>
      locations
        .filter((l) => l.totalQty > 0)
        .map((l) => ({ id: l.id, name: l.name, value: l.totalQty, type: l.type })),
    [locations]
  )

  const selectedLocation = locations.find((l) => l.id === selectedLocationId)

  // 선택된 위치의 상품별 수량 비중 (서버 productBreakdown — 필터 무관 전체 기준)
  const productPieData = useMemo<PieEntry[]>(() => {
    if (!selectedLocation) return []
    return selectedLocation.productBreakdown
      .slice(0, 8) // 최대 8개 표시 (이미 qty 내림차순)
      .map((p) => ({ id: p.productId, name: p.productName, value: p.qty }))
  }, [selectedLocation])

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="text-sm">위치별 재고 분포</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading ? (
          <div className="space-y-2">
            <div className="mx-auto h-48 w-48 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          </div>
        ) : locationPieData.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {locations.length === 0 ? '등록된 위치가 없습니다' : '재고가 있는 위치가 없습니다'}
          </p>
        ) : (
          <div className="space-y-4">
            {/* 위치별 도넛 차트 */}
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={locationPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                  onClick={(entry) => {
                    // recharts payload 구조가 일관되지 않아 직접 id와 payload.id 양쪽 방어
                    const d = entry as unknown as { id?: string; payload?: PieEntry }
                    const id = d.id ?? d.payload?.id
                    if (!id) return
                    setSelectedLocationId((prev) => (prev === id ? null : id))
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {locationPieData.map((entry, index) => (
                    <Cell
                      key={entry.id}
                      fill={LOCATION_COLORS[index % LOCATION_COLORS.length]}
                      opacity={selectedLocationId && selectedLocationId !== entry.id ? 0.4 : 1}
                      stroke={selectedLocationId === entry.id ? '#1e293b' : 'transparent'}
                      strokeWidth={selectedLocationId === entry.id ? 2 : 0}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid hsl(var(--border))',
                    backgroundColor: 'hsl(var(--background))',
                  }}
                  formatter={(value, name) => [
                    `${KRW.format(Number(value ?? 0))} EA`,
                    String(name ?? ''),
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value: string, entry: unknown) => {
                    const loc = (entry as { payload?: PieEntry })?.payload
                    const typeLabel = loc?.type
                      ? LOCATION_TYPE_LABEL[loc.type as keyof typeof LOCATION_TYPE_LABEL]
                      : ''
                    return `${value}${typeLabel ? ` (${typeLabel})` : ''}`
                  }}
                  onClick={(entry) => {
                    const d = entry as unknown as { payload?: PieEntry }
                    const id = d.payload?.id
                    if (!id) return
                    setSelectedLocationId((prev) => (prev === id ? null : id))
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* 선택된 위치 드릴다운 */}
            {selectedLocationId && selectedLocation && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{selectedLocation.name}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {LOCATION_TYPE_LABEL[selectedLocation.type]}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => onViewLocationDetail(selectedLocationId)}
                  >
                    위치 재고 상세 보기
                  </Button>
                </div>

                {/* 상품 비중 미니 차트 */}
                {productPieData.length > 0 ? (
                  <div>
                    <p className="mb-1 text-[11px] text-muted-foreground">상품별 수량 비중</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie
                          data={productPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={35}
                          outerRadius={60}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {productPieData.map((entry, index) => (
                            <Cell
                              key={entry.id}
                              fill={PRODUCT_COLORS[index % PRODUCT_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            fontSize: 11,
                            borderRadius: 8,
                            border: '1px solid hsl(var(--border))',
                            backgroundColor: 'hsl(var(--background))',
                          }}
                          formatter={(value, name) => [
                            `${KRW.format(Number(value ?? 0))} EA`,
                            String(name ?? ''),
                          ]}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">이 위치의 재고 데이터가 없습니다</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
