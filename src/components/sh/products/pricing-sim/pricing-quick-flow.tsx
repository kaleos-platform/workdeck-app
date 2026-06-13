'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { groupOptionsByPrice, type PriceGroup } from '@/lib/sh/price-group'
import { snapPrice } from '@/lib/sh/price-snap'
import { calculateMatrix } from '@/lib/sh/pricing-matrix-calc'
import type { MatrixBundle, MatrixChannel, MatrixGlobals } from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { SELLER_HUB_LISTING_NEW_PATH } from '@/lib/deck-routes'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type ProductHit = {
  productId: string
  productName: string
}

// /api/sh/pricing-options 응답 형태 (옵션 단위)
type PricingOptionRaw = {
  optionId: string
  optionName: string
  sku: string | null
  productId: string
  productName: string
  brandName: string | null
  costPrice: number | null
  retailPrice: number | null
  totalStock: number
  msrp: number | null
}

// /api/sh/products/[productId]/options 응답 형태
// Decimal 필드는 string으로 반환됨 — Number() 변환 필수
type ApiProductOption = {
  id: string
  name: string
  sku: string | null
  costPrice: string | number | null
  retailPrice: string | number | null
  sizeLabel: string | null
  attributeValues: Record<string, string> | null
  totalStock: number
}

// /api/channels 응답 형태 (pricing-sim-main.tsx 300-332 참조)
type ApiCh = {
  id: string
  name: string
  channelTypeDef: { id: string; name: string; isSalesChannel: boolean } | null
  useSimulation: boolean
  feeRates: { categoryName: string; ratePercent: string | number }[]
  shippingFee: string | number | null
  freeShippingThreshold: string | number | null
  applyAdCost: boolean
  paymentFeeIncluded: boolean
  paymentFeePct: string | number | null
}

// settings API 응답 형태
type SettingsRaw = {
  defaultOperatingCostPct?: number
  defaultAdCostPct?: number
  defaultPackagingCost?: number
  platformTargetGood?: number
  platformTargetFair?: number
  minimumAcceptableMargin?: number
  expectedReturnRate?: number
  returnHandlingCost?: number
}

type FullSettings = {
  defaultOperatingCostPct: number
  defaultAdCostPct: number
  defaultPackagingCost: number
  platformTargetGood: number
  platformTargetFair: number
  minimumAcceptableMargin: number
  expectedReturnRate: number
  returnHandlingCost: number
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

/** ApiCh → MatrixChannel 변환 (pricing-sim-main.tsx 180-210 참조, db 브랜치 사용) */
function apiChToMatrixChannel(c: ApiCh): MatrixChannel {
  const channelType = c.channelTypeDef?.isSalesChannel === false ? 'INTERNAL_TRANSFER' : null
  return {
    id: c.id,
    name: c.name,
    channelType,
    feeRates:
      c.feeRates.length > 0
        ? c.feeRates.map((fr) => ({
            categoryName: fr.categoryName,
            ratePercent: Number(fr.ratePercent),
          }))
        : [{ categoryName: '기본', ratePercent: 0 }],
    paymentFeeIncluded: c.paymentFeeIncluded,
    paymentFeePct: c.paymentFeePct != null ? Number(c.paymentFeePct) : 0,
    applyAdCost: c.applyAdCost,
    shippingFee: c.shippingFee != null ? Number(c.shippingFee) : 0,
    freeShippingThreshold: c.freeShippingThreshold != null ? Number(c.freeShippingThreshold) : null,
  }
}

/** settings → MatrixGlobals (pricing-sim-main.tsx 545-559 참조) */
function buildGlobals(s: FullSettings): MatrixGlobals {
  return {
    includeVat: true,
    vatRate: 0.1,
    adCostPct: s.defaultAdCostPct / 100,
    operatingCostPct: s.defaultOperatingCostPct / 100,
    applyReturnAdjustment: false,
    expectedReturnRate: s.expectedReturnRate,
    returnHandlingCost: s.returnHandlingCost,
    minimumAcceptableMargin: s.minimumAcceptableMargin,
  }
}

/** settings → TierThresholds (pricing-sim-main.tsx 556-559 참조) */
function buildThresholds(s: FullSettings): TierThresholds {
  return {
    platformTargetGood: s.platformTargetGood,
    platformTargetFair: s.platformTargetFair,
  }
}

/** 숫자 포맷 */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

/** 마진 티어 색상 */
function tierColor(tier: 'good' | 'fair' | 'bad'): string {
  if (tier === 'good') return 'text-emerald-600'
  if (tier === 'fair') return 'text-amber-600'
  return 'text-destructive'
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

export function PricingQuickFlow() {
  const router = useRouter()

  // ── 글로벌 설정 (초기 로드) ────────────────────────────────────────────────
  const [settings, setSettings] = useState<FullSettings>({
    defaultOperatingCostPct: 0,
    defaultAdCostPct: 0,
    defaultPackagingCost: 0,
    platformTargetGood: 0.25,
    platformTargetFair: 0.15,
    minimumAcceptableMargin: 0.1,
    expectedReturnRate: 0.05,
    returnHandlingCost: 5000,
  })

  // ── 채널 목록 (판매 채널만 — isSalesChannel=true) ─────────────────────────
  const [channels, setChannels] = useState<ApiCh[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [stRes, chRes] = await Promise.all([
          fetch('/api/sh/settings'),
          // 판매 채널만 조회 (listing-create-form과 동일한 필터)
          fetch('/api/channels?isActive=true&isSalesChannel=true'),
        ])
        if (stRes.ok) {
          const d: { settings: SettingsRaw } = await stRes.json()
          const s = d.settings ?? {}
          if (!cancelled) {
            setSettings({
              defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? 0) || 0,
              defaultAdCostPct: Number(s.defaultAdCostPct ?? 0) || 0,
              defaultPackagingCost: Number(s.defaultPackagingCost ?? 0) || 0,
              platformTargetGood: Number(s.platformTargetGood ?? 0.25),
              platformTargetFair: Number(s.platformTargetFair ?? 0.15),
              minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? 0.1),
              expectedReturnRate: Number(s.expectedReturnRate ?? 0.05),
              returnHandlingCost: Number(s.returnHandlingCost ?? 5000),
            })
          }
        }
        if (chRes.ok) {
          const d: { channels?: ApiCh[] } = await chRes.json()
          if (!cancelled) setChannels(d.channels ?? [])
        }
      } catch {
        // 설정 로드 실패 시 기본값 유지
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Step 1: 상품 검색 및 선택 ──────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [searchResults, setSearchResults] = useState<PricingOptionRaw[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductHit | null>(null)

  // 검색 디바운스
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // 상품 검색
  useEffect(() => {
    if (!debounced.trim()) {
      setSearchResults([])
      return
    }
    let cancelled = false
    const load = async () => {
      setSearchLoading(true)
      try {
        const qs = new URLSearchParams({ search: debounced.trim(), pageSize: '30' })
        const res = await fetch(`/api/sh/pricing-options?${qs.toString()}`)
        if (!res.ok) throw new Error('검색 실패')
        const data: { data: PricingOptionRaw[] } = await res.json()
        if (!cancelled) setSearchResults(data.data ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '검색 실패')
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [debounced])

  // 검색 결과를 상품 단위로 dedup
  const productHits = useMemo(() => {
    const seen = new Set<string>()
    const hits: ProductHit[] = []
    for (const r of searchResults) {
      if (!seen.has(r.productId)) {
        seen.add(r.productId)
        hits.push({ productId: r.productId, productName: r.productName })
      }
    }
    return hits
  }, [searchResults])

  // ── Step 2: 상품 선택 후 옵션 로드 → 가격 그룹 ────────────────────────────
  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>('')
  // 그룹 내 모든 옵션 (구체 옵션 선택 Select용)
  const [groupOptions, setGroupOptions] = useState<ApiProductOption[]>([])
  // 대표 옵션 → 사용자가 구체 옵션을 직접 선택 가능
  const [selectedOptionId, setSelectedOptionId] = useState<string>('')

  const handlePickProduct = async (hit: ProductHit) => {
    setSelectedProduct(hit)
    setSearch('')
    setSearchResults([])
    setPriceGroups([])
    setSelectedGroupKey('')
    setGroupOptions([])
    setSelectedOptionId('')
    setSelectedChannelId('')
    setSalePriceInput('')

    setGroupsLoading(true)
    try {
      const res = await fetch(`/api/sh/products/${hit.productId}/options`)
      if (!res.ok) throw new Error('옵션 조회 실패')
      const data: { options: ApiProductOption[] } = await res.json()
      const options = data.options ?? []

      // Decimal → number 변환 (API는 string으로 반환)
      const converted = options.map((o) => ({
        ...o,
        costPrice: o.costPrice != null ? Number(o.costPrice) : null,
        retailPrice: o.retailPrice != null ? Number(o.retailPrice) : null,
      }))

      setGroupOptions(converted)
      const groups = groupOptionsByPrice(
        converted.map((o) => ({
          optionId: o.id,
          optionName: o.name,
          costPrice: o.costPrice as number | null,
          retailPrice: o.retailPrice as number | null,
          attributeValues: o.attributeValues,
          sizeLabel: o.sizeLabel,
        }))
      )
      setPriceGroups(groups)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '옵션 조회 실패')
    } finally {
      setGroupsLoading(false)
    }
  }

  // 선택된 그룹
  const selectedGroup = useMemo(
    () => priceGroups.find((g) => g.key === selectedGroupKey) ?? null,
    [priceGroups, selectedGroupKey]
  )

  // 그룹 내 옵션 목록 (구체 옵션 Select용)
  const groupMemberOptions = useMemo(() => {
    if (!selectedGroup) return []
    return groupOptions.filter((o) => selectedGroup.optionIds.includes(o.id))
  }, [selectedGroup, groupOptions])

  // 그룹 선택 시 대표 옵션으로 기본 설정
  const handleGroupChange = (key: string) => {
    setSelectedGroupKey(key)
    const group = priceGroups.find((g) => g.key === key)
    if (group) setSelectedOptionId(group.representativeOptionId)
  }

  // ── Step 3: 채널 선택 ─────────────────────────────────────────────────────
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')

  const selectedChannel = useMemo(
    () => channels.find((c) => c.id === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  )

  const matrixChannel: MatrixChannel | null = useMemo(
    () => (selectedChannel ? apiChToMatrixChannel(selectedChannel) : null),
    [selectedChannel]
  )

  // ── Step 4: 판매가 입력 및 매트릭스 계산 ───────────────────────────────────
  const [salePriceInput, setSalePriceInput] = useState<string>('')
  const salePrice = useMemo(() => {
    const n = Number(salePriceInput)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [salePriceInput])

  const matrixGlobals = useMemo(() => buildGlobals(settings), [settings])
  const tierThresholds = useMemo(() => buildThresholds(settings), [settings])

  // 추천가: 그룹 + 채널 선택되면 salePrice와 무관하게 계산
  const recommendedPrices = useMemo(() => {
    if (!selectedGroup || !matrixChannel) return null
    const bundle: MatrixBundle = {
      components: [
        {
          costPrice: selectedGroup.costPrice ?? 0,
          retailPrice: selectedGroup.retailPrice ?? 0,
          quantity: 1,
        },
      ],
      packagingCost: settings.defaultPackagingCost,
      salePrice: selectedGroup.retailPrice ?? 0, // 추천가 역산 기준가 (salePrice는 무관)
    }
    const result = calculateMatrix({
      bundle,
      channel: matrixChannel,
      promotion: { type: 'NONE', value: 0 },
      globals: matrixGlobals,
      thresholds: tierThresholds,
    })
    return result.recommendedRetail
  }, [selectedGroup, matrixChannel, settings.defaultPackagingCost, matrixGlobals, tierThresholds])

  // 마진 계산: salePrice 입력값으로
  const marginResult = useMemo(() => {
    if (!selectedGroup || !matrixChannel || salePrice <= 0) return null
    const bundle: MatrixBundle = {
      components: [
        {
          costPrice: selectedGroup.costPrice ?? 0,
          retailPrice: selectedGroup.retailPrice ?? 0,
          quantity: 1,
        },
      ],
      packagingCost: settings.defaultPackagingCost,
      salePrice,
    }
    const matrix = calculateMatrix({
      bundle,
      channel: matrixChannel,
      promotion: { type: 'NONE', value: 0 },
      globals: matrixGlobals,
      thresholds: tierThresholds,
    })
    // cells[0] = 0% 할인 셀
    return matrix.cells[0]
  }, [
    selectedGroup,
    matrixChannel,
    salePrice,
    settings.defaultPackagingCost,
    matrixGlobals,
    tierThresholds,
  ])

  // ── 판매채널 상품 생성 핸들러 ─────────────────────────────────────────────
  const handleCreateListing = () => {
    if (!selectedProduct || !selectedGroup || !selectedOptionId || salePrice <= 0) {
      toast.error('상품, 가격 그룹, 옵션, 판매가를 모두 입력해 주세요')
      return
    }

    const key = `pricing-prefill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const payload = {
      schemaVersion: 2,
      // spaceId는 클라이언트에서 확인하지 않음 — API가 잘못된 옵션에 대해 404를 반환
      spaceId: '',
      channelId: selectedChannelId || null,
      productId: selectedProduct.productId,
      items: [
        {
          optionId: selectedOptionId,
          productId: selectedProduct.productId,
          quantity: 1,
        },
      ],
      salePrice,
      createdAt: Date.now(),
    }

    try {
      sessionStorage.setItem(key, JSON.stringify(payload))
    } catch {
      toast.error('세션 스토리지 저장 실패')
      return
    }

    router.push(`${SELLER_HUB_LISTING_NEW_PATH}?prefillKey=${key}`)
  }

  // ── 입력 완성도 체크 ──────────────────────────────────────────────────────
  const hasGroup = Boolean(selectedGroup)
  const hasChannel = Boolean(selectedChannelId)
  const canCreate =
    Boolean(selectedProduct) && hasGroup && Boolean(selectedOptionId) && salePrice > 0

  // ─── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          빠른 적정가{' '}
          <Badge variant="secondary" className="ml-1 text-[10px]">
            베타
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Step 1: 상품 검색 ── */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">1. 상품 선택</Label>
          {selectedProduct ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <span className="flex-1 text-sm font-medium">{selectedProduct.productName}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelectedProduct(null)
                  setPriceGroups([])
                  setSelectedGroupKey('')
                  setGroupOptions([])
                  setSelectedOptionId('')
                  setSelectedChannelId('')
                  setSalePriceInput('')
                }}
              >
                변경
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="상품명 / SKU / 브랜드 검색"
                  className="h-8 pl-9 text-sm"
                />
              </div>
              {(searchLoading || productHits.length > 0) && (
                <div className="max-h-48 overflow-y-auto rounded-md border bg-popover shadow-md">
                  {searchLoading ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">검색 중...</p>
                  ) : (
                    <ul className="divide-y">
                      {productHits.map((hit) => (
                        <li key={hit.productId}>
                          <button
                            type="button"
                            onClick={() => handlePickProduct(hit)}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted/60"
                          >
                            {hit.productName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Step 2: 가격 그룹 선택 ── */}
        {selectedProduct && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">2. 가격 그룹 선택</Label>
            {groupsLoading ? (
              <p className="text-xs text-muted-foreground">옵션 로딩 중...</p>
            ) : priceGroups.length === 0 ? (
              <p className="text-xs text-muted-foreground">옵션이 없습니다</p>
            ) : (
              <Select value={selectedGroupKey} onValueChange={handleGroupChange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="가격 그룹을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {priceGroups.map((g) => (
                    <SelectItem key={g.key} value={g.key} disabled={g.priceUndefined}>
                      {g.sharedLabel}
                      {g.priceUndefined && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(원가 미정)</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* 그룹 내 구체 옵션 선택 (대표→구체 확정 UX) */}
            {selectedGroup && groupMemberOptions.length > 1 && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  등록할 옵션 선택 <span className="font-normal">(기본: 대표 옵션)</span>
                </Label>
                <Select value={selectedOptionId} onValueChange={setSelectedOptionId}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="옵션 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupMemberOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                        {o.totalStock != null && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            (재고 {o.totalStock.toLocaleString()})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: 채널 선택 ── */}
        {selectedProduct && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">3. 판매채널 선택</Label>
            <Select value={selectedChannelId} onValueChange={setSelectedChannelId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="채널을 선택하세요 (선택)" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ── Step 4: 판매가 입력 + 추천가 배지 + 마진 표시 ── */}
        {hasGroup && hasChannel && (
          <div className="space-y-3">
            <Label className="text-xs font-semibold text-muted-foreground">4. 판매가 설정</Label>

            {/* 추천가 배지 — salePrice와 무관하게 표시 */}
            {recommendedPrices && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">추천 판매가 (클릭 시 적용)</p>
                <div className="flex flex-wrap gap-1.5">
                  {recommendedPrices.good != null && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSalePriceInput(String(recommendedPrices.good))}
                        className="rounded px-0 py-0"
                      >
                        <Badge
                          variant="outline"
                          className="cursor-pointer text-emerald-700 hover:bg-emerald-50"
                        >
                          good {fmt(recommendedPrices.good)}원
                        </Badge>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSalePriceInput(String(snapPrice(recommendedPrices.good!, 'end900')))
                        }
                        className="rounded px-0 py-0"
                      >
                        <Badge
                          variant="outline"
                          className="cursor-pointer text-emerald-700 hover:bg-emerald-50"
                        >
                          good {fmt(snapPrice(recommendedPrices.good, 'end900'))}원 (…900)
                        </Badge>
                      </button>
                    </>
                  )}
                  {recommendedPrices.fair != null && (
                    <button
                      type="button"
                      onClick={() => setSalePriceInput(String(recommendedPrices.fair))}
                      className="rounded px-0 py-0"
                    >
                      <Badge
                        variant="outline"
                        className="cursor-pointer text-amber-700 hover:bg-amber-50"
                      >
                        fair {fmt(recommendedPrices.fair)}원
                      </Badge>
                    </button>
                  )}
                  {recommendedPrices.min != null && (
                    <button
                      type="button"
                      onClick={() => setSalePriceInput(String(recommendedPrices.min))}
                      className="rounded px-0 py-0"
                    >
                      <Badge
                        variant="outline"
                        className="cursor-pointer text-muted-foreground hover:bg-muted"
                      >
                        min {fmt(recommendedPrices.min)}원
                      </Badge>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 판매가 입력 */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  type="number"
                  value={salePriceInput}
                  onChange={(e) => setSalePriceInput(e.target.value)}
                  placeholder="판매가 입력"
                  className="h-8 [appearance:textfield] pr-6 text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  min={0}
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
                  원
                </span>
              </div>
            </div>

            {/* 마진 표시 */}
            {marginResult && salePrice > 0 && (
              <div className="rounded-md border bg-muted/20 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span>
                    마진율{' '}
                    <span className={`font-semibold tabular-nums ${tierColor(marginResult.tier)}`}>
                      {(marginResult.margin * 100).toFixed(1)}%
                    </span>
                  </span>
                  <span>
                    순수익{' '}
                    <span className="font-semibold tabular-nums">
                      {fmt(marginResult.netProfit)}원
                    </span>
                  </span>
                  <Badge
                    variant="outline"
                    className={`px-1.5 py-0 text-[10px] ${
                      marginResult.tier === 'good'
                        ? 'border-emerald-300 text-emerald-700'
                        : marginResult.tier === 'fair'
                          ? 'border-amber-300 text-amber-700'
                          : 'border-destructive/50 text-destructive'
                    }`}
                  >
                    {marginResult.tier === 'good'
                      ? '양호'
                      : marginResult.tier === 'fair'
                        ? '보통'
                        : '미달'}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 생성 버튼 ── */}
        {selectedProduct && (
          <Button onClick={handleCreateListing} disabled={!canCreate} size="sm" className="w-full">
            판매채널 상품으로 생성
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
