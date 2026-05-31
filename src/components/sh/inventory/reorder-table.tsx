'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PlusIcon } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type ReorderRow = {
  productId: string
  productName: string
  productCode: string | null
  brandId: string | null
  brandName: string | null
  optionId: string
  optionName: string
  sku: string | null
  currentStock: number
  totalOutbound: number
  windowDays: number
  dailyAvgOutbound: number
  leadTimeDays: number
  safetyStockQty: number
  neededStock: number
  reorderQty: number
  estimatedDepletionDays: number | null
  isUrgent: boolean
  hasConfig: boolean
}

type Brand = { id: string; name: string }
type ProductOption = { id: string; name: string }
type Filter = 'all' | 'needed' | 'urgent'

const ALL = 'all'
const NO_BRAND = 'none'

function statusBadge(row: ReorderRow) {
  if (row.totalOutbound === 0) {
    return (
      <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-600">
        데이터 부족
      </Badge>
    )
  }
  if (row.reorderQty > 0) {
    return (
      <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
        발주 필요
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
      정상
    </Badge>
  )
}

function formatDepletion(d: number | null) {
  if (d === null) return '-'
  return `${d.toFixed(1)}일`
}

/**
 * ReorderTable
 * - 기본(전체) 모드: 브랜드/상품 필터 드롭다운 노출. (현재는 단일상품 생성 플로우에서만 사용)
 * - 단일상품 모드(`productId` 지정): 해당 상품 옵션만 표시, 필터 드롭다운 숨김.
 *   내장 "발주 계획 생성" 버튼이 해당 productId로 POST 한다.
 */
export function ReorderTable({
  productId,
}: {
  productId?: string
} = {}) {
  const router = useRouter()
  const singleProduct = productId != null
  const [rows, setRows] = useState<ReorderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [windowDays, setWindowDays] = useState(90)
  const [creating, setCreating] = useState(false)

  const [brands, setBrands] = useState<Brand[]>([])
  const [productOptions, setProductOptions] = useState<ProductOption[]>([])
  const [brandFilter, setBrandFilter] = useState<string>(ALL)
  const [productIdFilter, setProductIdFilter] = useState<string>(singleProduct ? productId : ALL)

  // 브랜드 / 상품 드롭다운 데이터 — 전체 모드에서만 필요
  useEffect(() => {
    if (singleProduct) return
    fetch('/api/sh/brands')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBrands(d?.brands ?? []))
      .catch(() => setBrands([]))
  }, [singleProduct])

  useEffect(() => {
    if (singleProduct) return
    fetch('/api/sh/products?pageSize=100')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = (d?.data ?? []) as Array<{ id: string; name: string }>
        setProductOptions(list.map((p) => ({ id: p.id, name: p.name })))
      })
      .catch(() => setProductOptions([]))
  }, [singleProduct])

  const fetchData = useCallback(async (f: Filter, brandId: string, productId: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f === 'needed') params.set('reorderNeededOnly', 'true')
      if (f === 'urgent') params.set('urgentOnly', 'true')
      if (brandId !== ALL) params.set('brandId', brandId)
      if (productId !== ALL) params.set('productId', productId)
      const qs = params.toString()
      const res = await fetch(`/api/sh/inventory/reorder${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('불러오기 실패')
      const json = (await res.json()) as { data: ReorderRow[]; windowDays: number }
      setRows(json.data)
      setWindowDays(json.windowDays)
    } catch (err) {
      console.error(err)
      toast.error('발주 예측 데이터를 불러오지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(filter, brandFilter, productIdFilter)
  }, [filter, brandFilter, productIdFilter, fetchData])

  const counts = useMemo(() => {
    const needed = rows.filter((r) => r.reorderQty > 0).length
    const urgent = rows.filter((r) => r.isUrgent).length
    return { total: rows.length, needed, urgent }
  }, [rows])

  const handleCreatePlan = async () => {
    if (!productId) {
      toast.error('상품을 먼저 선택해주세요')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      })
      if (!res.ok) throw new Error('생성 실패')
      const data = (await res.json()) as { planId: string }
      toast.success('발주 계획 초안이 생성되었습니다')
      router.push(`/d/seller-ops/inventory/reorder/plans/${data.planId}`)
    } catch (err) {
      console.error(err)
      toast.error('발주 계획 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  // 리드타임 다이얼로그에서 쓸 상품 목록 (테이블 rows에서 중복 제거)
  const productsInTable = useMemo(() => {
    const map = new Map<string, { productId: string; productName: string; leadTimeDays: number }>()
    for (const r of rows) {
      if (!map.has(r.productId)) {
        map.set(r.productId, {
          productId: r.productId,
          productName: r.productName,
          leadTimeDays: r.leadTimeDays,
        })
      }
    }
    return Array.from(map.values())
  }, [rows])

  // 같은 productId 연속 행에서 첫 행에만 상품명 표시용
  const firstRowByProduct = useMemo(() => {
    const set = new Set<string>()
    return rows.map((r) => {
      if (set.has(r.productId)) return false
      set.add(r.productId)
      return true
    })
  }, [rows])

  return (
    <div className="space-y-4">
      {/* 상태 필터 + 리드타임 설정 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          전체
        </Button>
        <Button
          size="sm"
          variant={filter === 'needed' ? 'default' : 'outline'}
          onClick={() => setFilter('needed')}
        >
          발주 필요만
        </Button>
        <Button
          size="sm"
          variant={filter === 'urgent' ? 'default' : 'outline'}
          onClick={() => setFilter('urgent')}
        >
          긴급 (7일 이내)
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            기본 {windowDays}일 · 옵션 {counts.total}건 · 발주 필요 {counts.needed}건 · 긴급{' '}
            {counts.urgent}건
          </div>
          <LeadTimeSettingsDialog
            products={productsInTable}
            onSaved={() => fetchData(filter, brandFilter, productIdFilter)}
          />
          <SafetyStockSettingsDialog
            rows={rows}
            onSaved={() => fetchData(filter, brandFilter, productIdFilter)}
          />
          <RoundUnitSettingsDialog products={productsInTable} />
          <Button size="sm" onClick={handleCreatePlan} disabled={creating} className="gap-1.5">
            <PlusIcon className="h-3.5 w-3.5" />
            {creating ? '생성 중...' : '발주 계획 생성'}
          </Button>
        </div>
      </div>

      {/* 드롭다운 필터 — 전체 모드에서만 (단일상품 모드는 productId 고정) */}
      {!singleProduct && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={productIdFilter} onValueChange={setProductIdFilter}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="전체 상품" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 상품</SelectItem>
              {productOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="전체 브랜드" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>전체 브랜드</SelectItem>
              <SelectItem value={NO_BRAND}>브랜드 없음</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
              <TableHead>옵션</TableHead>
              <TableHead>브랜드</TableHead>
              <TableHead>관리코드(SKU)</TableHead>
              <TableHead className="text-right">현재재고</TableHead>
              <TableHead className="text-right">{windowDays}일 출고</TableHead>
              <TableHead className="text-right">일평균</TableHead>
              <TableHead className="text-right" title="상품 단위 공용 설정">
                리드타임
              </TableHead>
              <TableHead className="text-right" title="옵션 단위 안전재고">
                안전재고
              </TableHead>
              <TableHead className="text-right">발주 필요량</TableHead>
              <TableHead className="text-right">예상 소진일</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                  분석할 옵션이 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, idx) => {
                const isFirstOfGroup = firstRowByProduct[idx]
                return (
                  <TableRow
                    key={row.optionId}
                    className={`${row.isUrgent ? 'bg-red-50/40' : ''} ${
                      isFirstOfGroup ? 'border-t-2 border-t-muted' : ''
                    }`}
                  >
                    <TableCell className="font-medium">
                      {isFirstOfGroup ? row.productName : ''}
                    </TableCell>
                    <TableCell className="text-sm">{row.optionName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {isFirstOfGroup ? (row.brandName ?? '-') : ''}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.sku ?? '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.currentStock}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.totalOutbound}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.dailyAvgOutbound.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {row.leadTimeDays}일
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {row.safetyStockQty}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {row.reorderQty > 0 ? row.reorderQty : '-'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDepletion(row.estimatedDepletionDays)}
                    </TableCell>
                    <TableCell>{statusBadge(row)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function LeadTimeSettingsDialog({
  products,
  onSaved,
}: {
  products: Array<{ productId: string; productName: string; leadTimeDays: number }>
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  // 다이얼로그가 열릴 때마다 편집 상태 초기화
  useEffect(() => {
    if (open) setEdit({})
  }, [open])

  const handleChange = (productId: string, value: string) => {
    const n = Number(value)
    setEdit((prev) => ({ ...prev, [productId]: Number.isFinite(n) ? n : 0 }))
  }

  const handleSave = async (productId: string, currentValue: number) => {
    const next = edit[productId]
    if (next === undefined || next === currentValue) {
      toast.info('변경사항이 없습니다')
      return
    }
    if (next < 0) {
      toast.error('리드타임은 0 이상이어야 합니다')
      return
    }
    setSaving((s) => ({ ...s, [productId]: true }))
    try {
      const res = await fetch(`/api/sh/inventory/reorder/config/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadTimeDays: next }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('리드타임을 저장했습니다')
      onSaved()
    } catch (err) {
      console.error(err)
      toast.error('리드타임 저장에 실패했습니다')
    } finally {
      setSaving((s) => ({ ...s, [productId]: false }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          리드타임 설정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>상품별 리드타임 설정</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {products.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              설정 가능한 상품이 없습니다
            </p>
          ) : (
            products.map((p) => {
              const value = edit[p.productId] ?? p.leadTimeDays
              const dirty = value !== p.leadTimeDays
              const isSaving = saving[p.productId] === true
              return (
                <div
                  key={p.productId}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{p.productName}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Input
                      type="number"
                      min={0}
                      className="h-8 w-20 text-right"
                      value={value}
                      onChange={(e) => handleChange(p.productId, e.target.value)}
                    />
                    <span>일</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={!dirty || isSaving}
                    onClick={() => handleSave(p.productId, p.leadTimeDays)}
                  >
                    {isSaving ? '...' : '저장'}
                  </Button>
                </div>
              )
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// reorderRoundUnit 설정 다이얼로그
// TODO: 번스타인 — PATCH /api/sh/inventory/products/[productId]/round-unit 구현 후 저장 연결
function RoundUnitSettingsDialog({
  products,
}: {
  products: Array<{ productId: string; productName: string; leadTimeDays: number }>
}) {
  const [open, setOpen] = useState(false)
  // 편집 상태: productId → roundUnit(10|100|1)
  const [edit, setEdit] = useState<Record<string, number>>({})

  const handleOpenChange = (next: boolean) => {
    if (next) setEdit({})
    setOpen(next)
  }

  const handleChange = (productId: string, value: string) => {
    const n = Number(value)
    setEdit((prev) => ({ ...prev, [productId]: Number.isFinite(n) ? n : 10 }))
  }

  const handleSave = (_productId: string) => {
    // TODO: 번스타인 API 추가 대기 — PATCH /api/sh/inventory/products/[productId]
    // body: { reorderRoundUnit: edit[productId] }
    toast.info('라운딩 단위 저장 API는 준비 중입니다 (번스타인 구현 예정)')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          라운딩 단위 설정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>상품별 발주 라운딩 단위 설정</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          발주 수량을 어떤 단위로 올림할지 설정합니다. (예: 10단위 → 제안 37개 → 40개)
        </p>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {products.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              설정 가능한 상품이 없습니다
            </p>
          ) : (
            products.map((p) => {
              const value = edit[p.productId] ?? 10
              return (
                <div
                  key={p.productId}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{p.productName}</div>
                  <Select value={String(value)} onValueChange={(v) => handleChange(p.productId, v)}>
                    <SelectTrigger className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1단위</SelectItem>
                      <SelectItem value="10">10단위</SelectItem>
                      <SelectItem value="100">100단위</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => handleSave(p.productId)}
                  >
                    저장
                  </Button>
                </div>
              )
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SafetyStockSettingsDialog({ rows, onSaved }: { rows: ReorderRow[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [edit, setEdit] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (open) setEdit({})
  }, [open])

  const handleChange = (optionId: string, value: string) => {
    const n = Number(value)
    setEdit((prev) => ({ ...prev, [optionId]: Number.isFinite(n) ? Math.max(0, n) : 0 }))
  }

  const handleSave = async (optionId: string, currentValue: number) => {
    const next = edit[optionId]
    if (next === undefined || next === currentValue) {
      toast.info('변경사항이 없습니다')
      return
    }
    if (next < 0) {
      toast.error('안전재고는 0 이상이어야 합니다')
      return
    }
    setSaving((s) => ({ ...s, [optionId]: true }))
    try {
      const res = await fetch(`/api/sh/inventory/options/${optionId}/safety-stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ safetyStockQty: next }),
      })
      if (!res.ok) throw new Error('저장 실패')
      toast.success('안전재고를 저장했습니다')
      onSaved()
    } catch (err) {
      console.error(err)
      toast.error('안전재고 저장에 실패했습니다')
    } finally {
      setSaving((s) => ({ ...s, [optionId]: false }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          안전재고 설정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>옵션별 안전재고 설정</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              설정 가능한 옵션이 없습니다
            </p>
          ) : (
            rows.map((row) => {
              const value = edit[row.optionId] ?? row.safetyStockQty
              const dirty = value !== row.safetyStockQty
              const isSaving = saving[row.optionId] === true
              return (
                <div
                  key={row.optionId}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.productName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.optionName} {row.sku ? `· ${row.sku}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Input
                      type="number"
                      min={0}
                      className="h-8 w-20 text-right"
                      value={value}
                      onChange={(e) => handleChange(row.optionId, e.target.value)}
                    />
                    <span>EA</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    disabled={!dirty || isSaving}
                    onClick={() => handleSave(row.optionId, row.safetyStockQty)}
                  >
                    {isSaving ? '...' : '저장'}
                  </Button>
                </div>
              )
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
