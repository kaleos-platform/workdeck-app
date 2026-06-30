'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, MapPinIcon, PackageIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { OptionPickerDialog } from '@/components/sh/products/listings/option-picker-dialog'
import { ReorderTable } from '@/components/sh/inventory/reorder-table'
import type { ReorderLocation } from '@/components/sh/inventory/reorder-plan-types'

type PickedProduct = {
  productId: string
  productName: string
  brandName: string | null
}

type Props = {
  /** 생성 모드 진입 시 상품 선택 팝업을 자동으로 연다 */
  autoOpen?: boolean
  /** 목록으로 복귀 (모드 토글 추가로 다이얼로그 닫기 시엔 호출 안 됨 — 부모의 "목록으로" 버튼 사용) */
  onCancel?: () => void
}

type Mode = 'product' | 'location'

/**
 * 발주 계획 생성 플로우.
 *
 * 모드 A — 상품:
 *   1) OptionPickerDialog 상품 선택 (autoOpen이면 자동 열림)
 *   2) 선택 후 ReorderTable(단일상품 모드) 표시
 *   3) ReorderTable 내 "발주 계획 생성" 버튼 → POST { productId } → 상세 이동
 *
 * 모드 B — 연동 위치:
 *   1) GET /api/sh/inventory/locations → externalSource 있는 위치 드롭다운
 *   2) "세트 발주 계획 생성" 버튼 → POST { locationId } → 상세 이동
 *   3) 실패(422 등)는 sonner 에러 토스트
 */
export function ReorderPlanCreate({ autoOpen = true }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('product')

  // ── 상품 모드 상태 ──────────────────────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(autoOpen)
  const [picked, setPicked] = useState<PickedProduct | null>(null)
  // 상품 선택 직후 picker가 onOpenChange(false)를 발화할 때 stale 방지용
  const justPickedRef = useRef(false)
  // 모드 전환으로 picker를 닫을 때 의도적 닫힘 구분용
  const modeChangingRef = useRef(false)

  // ── 연동 위치 모드 상태 ─────────────────────────────────────────────────────
  const [locations, setLocations] = useState<ReorderLocation[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [creating, setCreating] = useState(false)

  // 연동 위치 목록 로드 (externalSource != null 만)
  useEffect(() => {
    if (mode !== 'location') return
    setLoadingLocations(true)
    fetch('/api/sh/inventory/locations?isActive=true')
      .then((res) => res.json())
      .then((data: { locations: ReorderLocation[] }) => {
        setLocations(data.locations.filter((l) => l.externalSource != null))
      })
      .catch((err) => {
        console.error(err)
        toast.error('연동 위치 목록을 불러오지 못했습니다')
      })
      .finally(() => setLoadingLocations(false))
  }, [mode])

  // 상품 선택 완료
  const handlePickProduct = (
    productId: string,
    opts: Array<{ productName: string; brandName: string | null }>
  ) => {
    const first = opts[0]
    justPickedRef.current = true
    setPicked({
      productId,
      productName: first?.productName ?? '',
      brandName: first?.brandName ?? null,
    })
    setPickerOpen(false)
  }

  // 팝업 닫힘: 모드 전환이나 상품 선택 직후는 무시, 그 외에는 닫힌 상태로만 유지
  // (onCancel 호출 제거 — 부모의 "계획 목록으로" 버튼으로 복귀)
  const handlePickerOpenChange = (open: boolean) => {
    setPickerOpen(open)
    if (open) {
      justPickedRef.current = false
      return
    }
    if (modeChangingRef.current) {
      modeChangingRef.current = false
      return
    }
    if (justPickedRef.current) {
      justPickedRef.current = false
    }
    // 닫혀도 모드 토글 + "상품 선택" 버튼 노출 — onCancel 호출 안 함
  }

  // 모드 전환
  const handleModeChange = (newMode: Mode) => {
    if (newMode === mode) return
    if (newMode === 'location' && pickerOpen) {
      // 모달 다이얼로그를 먼저 닫아야 함 — 의도적 닫기 플래그 설정
      modeChangingRef.current = true
      setPickerOpen(false)
    }
    if (newMode === 'product') {
      setPicked(null)
      setPickerOpen(true)
      setSelectedLocationId('')
    }
    setMode(newMode)
  }

  // 세트 발주 계획 생성 (연동 위치 모드)
  const handleCreateLocationPlan = async () => {
    if (!selectedLocationId) return
    setCreating(true)
    try {
      const res = await fetch('/api/sh/inventory/reorder/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: selectedLocationId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(body.message ?? '생성 실패')
      }
      const data = (await res.json()) as { planId: string }
      toast.success('세트 발주 계획 초안이 생성되었습니다')
      router.push(`/d/seller-ops/inventory/reorder/plans/${data.planId}`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : '발주 계획 생성에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  // ── 모드 토글 UI ────────────────────────────────────────────────────────────
  const modeToggle = (
    <div className="flex w-fit items-center gap-1 rounded-md border bg-muted/30 p-1">
      <button
        type="button"
        onClick={() => handleModeChange('product')}
        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
          mode === 'product'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <PackageIcon className="h-3.5 w-3.5" />
        상품
      </button>
      <button
        type="button"
        onClick={() => handleModeChange('location')}
        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
          mode === 'location'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <MapPinIcon className="h-3.5 w-3.5" />
        연동 위치
      </button>
    </div>
  )

  // ── 연동 위치 모드 ──────────────────────────────────────────────────────────
  if (mode === 'location') {
    return (
      <div className="space-y-4">
        {modeToggle}
        <div className="space-y-3 rounded-md border bg-card px-4 py-4">
          <div>
            <p className="text-sm font-medium">연동 위치 선택</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              세트 상품(ProductListing)이 등록된 연동 위치를 선택하면 세트 단위 발주 계획이
              생성됩니다.
            </p>
          </div>
          <Select
            value={selectedLocationId}
            onValueChange={setSelectedLocationId}
            disabled={loadingLocations}
          >
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue placeholder={loadingLocations ? '불러오는 중...' : '연동 위치 선택'} />
            </SelectTrigger>
            <SelectContent>
              {locations.length === 0 && !loadingLocations ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  연동된 위치가 없습니다
                </div>
              ) : (
                locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    <span>{loc.name}</span>
                    {loc.externalSource && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        ({loc.externalSource})
                      </span>
                    )}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            onClick={handleCreateLocationPlan}
            disabled={!selectedLocationId || creating}
            className="gap-1.5"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {creating ? '생성 중...' : '세트 발주 계획 생성'}
          </Button>
        </div>
      </div>
    )
  }

  // ── 상품 모드: 상품 미선택 + 팝업 닫힘 → 선택 버튼 표시 ───────────────────
  if (!picked && !pickerOpen) {
    return (
      <div className="space-y-4">
        {modeToggle}
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed bg-muted/20 py-10">
          <p className="text-sm text-muted-foreground">
            상품을 선택해 옵션별 예측 수량을 확인하세요
          </p>
          <Button variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)}>
            <PackageIcon className="h-3.5 w-3.5" />
            상품 선택
          </Button>
        </div>
        <OptionPickerDialog
          open={false}
          onOpenChange={handlePickerOpenChange}
          mode="product-with-all-options"
          onPickProduct={handlePickProduct}
          contextLabel="발주 계획"
        />
      </div>
    )
  }

  // ── 상품 모드: 상품 미선택 + 팝업 열림 (autoOpen 초기 상태) ──────────────
  if (!picked) {
    return (
      <div className="space-y-4">
        {modeToggle}
        <OptionPickerDialog
          open={pickerOpen}
          onOpenChange={handlePickerOpenChange}
          mode="product-with-all-options"
          onPickProduct={handlePickProduct}
          contextLabel="발주 계획"
        />
      </div>
    )
  }

  // ── 상품 모드: 상품 선택 완료 → ReorderTable ────────────────────────────────
  return (
    <div className="space-y-4">
      {modeToggle}
      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{picked.productName}</div>
          {picked.brandName && (
            <div className="text-xs text-muted-foreground">{picked.brandName}</div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            setPicked(null)
            setPickerOpen(true)
          }}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          다른 상품 선택
        </Button>
      </div>

      {/* 단일상품 모드: 내장 "발주 계획 생성" 버튼이 productId로 POST */}
      <ReorderTable productId={picked.productId} />
    </div>
  )
}
