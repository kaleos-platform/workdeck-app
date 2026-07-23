'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { productDisplayName } from '@/lib/sh/product-display'
import {
  SELLER_HUB_PRICING_SIM_NEW_PATH,
  SELLER_HUB_PRICING_SIM_NEW_PRODUCT_PATH,
  getSellerHubPricingScenarioPath,
} from '@/lib/deck-routes'
import { mapPricingSettings } from '@/lib/sh/pricing-settings'
import { type ScenarioRow, priceRangeText } from './pricing-scenario-format'
import { PricingDefaultsDialog, type PricingFullSettings } from './pricing-defaults-dialog'

type ProductOption = { id: string; label: string }

const PAGE_SIZE = 20

export function PricingScenarioList() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<ScenarioRow[]>([])
  const [total, setTotal] = useState(0)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<PricingFullSettings | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 시뮬레이션 기본값 로드 (기본값 설정 다이얼로그용)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/sh/settings')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setSettings(mapPricingSettings(json.settings))
      } catch {
        // 무시 — 열 때 null이면 버튼 비활성
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // 상품 필터 옵션 로드
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/sh/products?pageSize=100&status=all')
        if (!res.ok) return
        const json = await res.json()
        const list: ProductOption[] = (json.data ?? json.products ?? []).map(
          (p: Parameters<typeof productDisplayName>[0] & { id: string }) => ({
            id: p.id,
            label: productDisplayName(p),
          })
        )
        if (!cancelled) setProducts(list)
      } catch {
        // 무시
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // 검색어 debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const fetchScenarios = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (productFilter !== 'all') params.set('productId', productFilter)
      const res = await fetch(`/api/sh/pricing-scenarios?${params.toString()}`)
      if (!res.ok) {
        setRows([])
        setTotal(0)
        return
      }
      const json = await res.json()
      setRows(json.data ?? [])
      setTotal(json.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, productFilter])

  useEffect(() => {
    void fetchScenarios()
  }, [fetchScenarios])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`시나리오 "${name}"을(를) 삭제하시겠습니까?`)) return
      setDeletingId(id)
      try {
        const res = await fetch(`/api/sh/pricing-scenarios/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('삭제 실패')
        toast.success('시나리오를 삭제했습니다')
        await fetchScenarios()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '삭제 실패')
      } finally {
        setDeletingId(null)
      }
    },
    [fetchScenarios]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">가격 시뮬레이션</h1>
          <p className="text-sm text-muted-foreground">저장된 가격 시나리오 목록</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSettingsOpen(true)}
            disabled={!settings}
          >
            <Settings2 className="mr-1 h-4 w-4" />
            기본값 설정
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-4 w-4" />
                시나리오 생성
                <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={SELLER_HUB_PRICING_SIM_NEW_PATH}>기존 상품으로 생성</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={SELLER_HUB_PRICING_SIM_NEW_PRODUCT_PATH}>신규 상품으로 생성</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {settings && (
        <PricingDefaultsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSettings={settings}
          onSaved={setSettings}
        />
      )}

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="시나리오 이름·메모 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={productFilter}
          onValueChange={(v) => {
            setProductFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="전체 상품" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상품</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 시나리오 테이블 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>상품</TableHead>
              <TableHead className="text-right">목표 마진</TableHead>
              <TableHead className="text-right">채널</TableHead>
              <TableHead className="text-right">권장가</TableHead>
              <TableHead>수정일</TableHead>
              <TableHead className="w-16 text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  불러오는 중...
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  저장된 가격 시나리오가 없습니다
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const goDetail = () => router.push(getSellerHubPricingScenarioPath(row.id))
                const productLabel = row.summary?.productNames?.join(', ') || '—'
                return (
                  <TableRow
                    key={row.id}
                    onClick={goDetail}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goDetail()
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${row.name} 상세`}
                    className="cursor-pointer hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  >
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      {row.memo && <div className="text-xs text-muted-foreground">{row.memo}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {row.summary?.mode === 'new' && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            신규 상품
                          </Badge>
                        )}
                        <span className="truncate">{productLabel}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.summary ? `${row.summary.targetMarginPct}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {row.summary ? `${row.summary.channelCount}개` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {priceRangeText(row.summary)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.updatedAt).toLocaleDateString('ko-KR')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === row.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(row.id, row.name)
                        }}
                        aria-label={`${row.name} 삭제`}
                      >
                        {deletingId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                        <span className="sr-only">삭제</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          총 {total.toLocaleString('ko-KR')}개 · {page} / {totalPages} 페이지
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음
          </Button>
        </div>
      </div>
    </div>
  )
}
