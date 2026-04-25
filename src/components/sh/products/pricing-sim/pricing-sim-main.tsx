'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Save, ChevronDown, GitCompare } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { PricingItemsTable, type PricingItemRow } from './pricing-items-table'
import { PricingOptionPickerDialog, type PricingOption } from './pricing-option-picker-dialog'
import { PricingComparisonDialog } from './pricing-comparison-dialog'
import { PricingDefaultsCard } from './pricing-defaults-card'
import { calculatePricing } from '@/lib/sh/pricing-calc'

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Channel = { id: string; name: string }

type ScenarioSummary = {
  id: string
  name: string
  memo: string | null
  channel: { id: string; name: string } | null
  includeVat: boolean
  vatRate: number
  itemCount: number
  totalNetProfit: number
  averageMargin: number
  updatedAt: string
}

type ScenarioDetail = ScenarioSummary & {
  items: {
    id: string
    optionId: string
    costPrice: number | null
    salePrice: number
    discountRate: number
    channelFeePct: number
    shippingCost: number
    packagingCost: number
    adCostPct: number
    operatingCostPct: number
    finalPrice: number
    revenueExVat: number
    totalCost: number
    netProfit: number
    margin: number
    option: {
      id: string
      name: string
      sku: string | null
      product: {
        id: string
        name: string
        brand: { id: string; name: string } | null
      }
    }
  }[]
}

type DefaultSettings = {
  defaultOperatingCostPct: number // 서버에서 0~100으로 저장 (pricingSettingsSchema 기준)
  defaultAdCostPct: number
  defaultPackagingCost: number
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeRowId() {
  return Math.random().toString(36).slice(2, 10)
}

function fmt(n: number) {
  return Math.round(n).toLocaleString('ko-KR')
}

function generateScenarioName(
  rows: PricingItemRow[],
  channels: Channel[],
  channelId: string
): string {
  if (rows.length === 0) return ''
  const distinctProducts = Array.from(new Set(rows.map((r) => r.productName)))
  const firstRow = rows[0]
  const channelName = channels.find((c) => c.id === channelId)?.name

  let core = distinctProducts[0]
  if (firstRow.brandName) core = `${firstRow.brandName} ${core}`
  if (distinctProducts.length > 1) core += ` 외 ${distinctProducts.length - 1}개`

  return channelName ? `${channelName} · ${core}` : core
}

function buildRowFromOption(opt: PricingOption, defaults: DefaultSettings): PricingItemRow {
  const costPrice = opt.costPrice ?? 0
  const salePrice = 0
  const discountRatePct = 0
  const channelFeePct = 0
  const shippingCost = 0
  const packagingCost = defaults.defaultPackagingCost
  const adCostPct = defaults.defaultAdCostPct // 이미 0~100
  const operatingCostPct = defaults.defaultOperatingCostPct // 이미 0~100

  const result = calculatePricing({
    costPrice,
    salePrice,
    discountRate: 0,
    channelFeePct: 0,
    shippingCost,
    packagingCost,
    adCostPct: adCostPct / 100,
    operatingCostPct: operatingCostPct / 100,
    includeVat: true,
    vatRate: 0.1,
  })

  return {
    rowId: makeRowId(),
    optionId: opt.optionId,
    productId: opt.productId,
    optionName: opt.optionName,
    productName: opt.productName,
    brandName: opt.brandName,
    costPrice,
    salePrice,
    discountRatePct,
    channelFeePct,
    shippingCost,
    packagingCost,
    adCostPct,
    operatingCostPct,
    result,
  }
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function PricingSimMain() {
  const nameId = useId()
  const memoId = useId()
  const router = useRouter()

  // 시나리오 목록
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [scenariosLoading, setScenariosLoading] = useState(true)

  // 비교 다이얼로그
  const [comparisonOpen, setComparisonOpen] = useState(false)

  // 현재 선택된 시나리오 id (null = 새 시나리오)
  const [activeId, setActiveId] = useState<string | null>(null)

  // 편집 중인 메타
  const [name, setName] = useState('')
  const [nameAuto, setNameAuto] = useState(true) // true면 옵션 변경 시 자동 추천
  const [memo, setMemo] = useState('')
  const [channelId, setChannelId] = useState<string>('')
  const [includeVat, setIncludeVat] = useState(true)
  const [vatRatePct, setVatRatePct] = useState(10) // UI: 10 = 10%

  // 아이템 행
  const [rows, setRows] = useState<PricingItemRow[]>([])

  // 채널 목록
  const [channels, setChannels] = useState<Channel[]>([])

  // 기본 설정
  const [defaults, setDefaults] = useState<DefaultSettings>({
    defaultOperatingCostPct: 0,
    defaultAdCostPct: 0,
    defaultPackagingCost: 0,
  })

  // UI 상태
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── 초기 데이터 로드 ──────────────────────────────────────────────────────

  useEffect(() => {
    const loadAll = async () => {
      try {
        const [scenRes, chRes, stRes] = await Promise.all([
          fetch('/api/sh/pricing-scenarios?pageSize=100'),
          fetch('/api/channels?isActive=true'),
          fetch('/api/sh/settings'),
        ])
        if (scenRes.ok) {
          const d: { data: ScenarioSummary[] } = await scenRes.json()
          setScenarios(d.data ?? [])
        }
        if (chRes.ok) {
          // /api/channels는 { channels: [...] } 형태로 응답함
          const d: { channels?: Channel[]; data?: Channel[] } = await chRes.json()
          setChannels(d.channels ?? d.data ?? [])
        }
        if (stRes.ok) {
          const d: { settings: Partial<DefaultSettings> } = await stRes.json()
          if (d.settings) {
            // 방어적 Number 변환 — Decimal이 string으로 올 가능성 차단
            setDefaults({
              defaultOperatingCostPct: Number(d.settings.defaultOperatingCostPct ?? 0) || 0,
              defaultAdCostPct: Number(d.settings.defaultAdCostPct ?? 0) || 0,
              defaultPackagingCost: Number(d.settings.defaultPackagingCost ?? 0) || 0,
            })
          }
        }
      } finally {
        setScenariosLoading(false)
      }
    }
    loadAll()
  }, [])

  // ── 시나리오 로드 ──────────────────────────────────────────────────────────

  const loadScenario = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/sh/pricing-scenarios/${id}`)
      if (!res.ok) throw new Error('시나리오 로드 실패')
      const data: ScenarioDetail = await res.json()

      setActiveId(data.id)
      setName(data.name)
      setNameAuto(false) // 저장된 시나리오는 사용자 입력값이므로 자동 추천 끔
      setMemo(data.memo ?? '')
      setChannelId(data.channel?.id ?? '')
      setIncludeVat(data.includeVat)
      setVatRatePct(Math.round(data.vatRate * 100))

      // 아이템 → 행 변환 (저장 값은 0~1, UI는 0~100)
      const loadedRows: PricingItemRow[] = data.items.map((it) => {
        const discountRatePct = Number((it.discountRate * 100).toFixed(4))
        const channelFeePct = Number((it.channelFeePct * 100).toFixed(4))
        const adCostPct = Number((it.adCostPct * 100).toFixed(4))
        const operatingCostPct = Number((it.operatingCostPct * 100).toFixed(4))

        const result = calculatePricing({
          costPrice: it.costPrice ?? 0,
          salePrice: it.salePrice,
          discountRate: it.discountRate,
          channelFeePct: it.channelFeePct,
          shippingCost: it.shippingCost,
          packagingCost: it.packagingCost,
          adCostPct: it.adCostPct,
          operatingCostPct: it.operatingCostPct,
          includeVat: data.includeVat,
          vatRate: data.vatRate,
        })

        return {
          rowId: makeRowId(),
          optionId: it.optionId,
          productId: it.option.product.id,
          optionName: it.option.name,
          productName: it.option.product.name,
          brandName: it.option.product.brand?.name ?? null,
          costPrice: it.costPrice ?? 0,
          salePrice: it.salePrice,
          discountRatePct,
          channelFeePct,
          shippingCost: it.shippingCost,
          packagingCost: it.packagingCost,
          adCostPct,
          operatingCostPct,
          result,
        }
      })
      setRows(loadedRows)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '시나리오 로드 실패')
    }
  }, [])

  // ── 새 시나리오로 리셋 ─────────────────────────────────────────────────────

  function resetToNew() {
    setActiveId(null)
    setName('')
    setNameAuto(true) // 새 시나리오는 자동 추천 활성화
    setMemo('')
    setChannelId('')
    setIncludeVat(true)
    setVatRatePct(10)
    setRows([])
  }

  // ── 옵션 변경 시 시나리오명 자동 추천 ────────────────────────────────────
  useEffect(() => {
    if (!nameAuto) return
    if (activeId !== null) return // 저장된 시나리오는 유지
    const suggested = generateScenarioName(rows, channels, channelId)
    Promise.resolve().then(() => setName(suggested))
  }, [rows, channels, channelId, nameAuto, activeId])

  // ── VAT 변경 시 모든 행 재계산 (자식이 아닌 부모에서 책임) ───────────────
  useEffect(() => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        result: calculatePricing({
          costPrice: r.costPrice,
          salePrice: r.salePrice,
          discountRate: r.discountRatePct / 100,
          channelFeePct: r.channelFeePct / 100,
          shippingCost: r.shippingCost,
          packagingCost: r.packagingCost,
          adCostPct: r.adCostPct / 100,
          operatingCostPct: r.operatingCostPct / 100,
          includeVat,
          vatRate: vatRatePct / 100,
        }),
      }))
    )
  }, [includeVat, vatRatePct])

  // ── 옵션 추가 핸들러 ───────────────────────────────────────────────────────

  function handlePickOption(opt: PricingOption) {
    setRows((prev) => {
      // 중복 방지 (functional update로 stale closure 방지)
      if (prev.some((r) => r.optionId === opt.optionId)) {
        return prev
      }
      return [...prev, buildRowFromOption(opt, defaults)]
    })
  }

  // ── 저장 ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!name.trim()) {
      toast.error('시나리오명을 입력하세요')
      return
    }
    if (rows.length === 0) {
      toast.error('옵션을 1개 이상 추가하세요')
      return
    }

    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        memo: memo.trim() || undefined,
        channelId: channelId || null,
        includeVat,
        vatRate: vatRatePct / 100,
        items: rows.map((r, idx) => ({
          optionId: r.optionId,
          costPrice: r.costPrice,
          salePrice: r.salePrice,
          discountRate: r.discountRatePct / 100,
          channelFeePct: r.channelFeePct / 100,
          shippingCost: r.shippingCost,
          packagingCost: r.packagingCost,
          adCostPct: r.adCostPct / 100,
          operatingCostPct: r.operatingCostPct / 100,
          sortOrder: idx,
        })),
      }

      let savedId = activeId

      if (activeId) {
        // PATCH
        const res = await fetch(`/api/sh/pricing-scenarios/${activeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.error ?? '저장 실패')
        }
        toast.success('시나리오가 업데이트되었습니다')
      } else {
        // POST
        const res = await fetch('/api/sh/pricing-scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.error ?? '저장 실패')
        }
        const created: { id: string } = await res.json()
        savedId = created.id
        setActiveId(created.id)
        toast.success('시나리오가 저장되었습니다')
      }

      // 시나리오 목록 갱신
      const listRes = await fetch('/api/sh/pricing-scenarios?pageSize=100')
      if (listRes.ok) {
        const d: { data: ScenarioSummary[] } = await listRes.json()
        setScenarios(d.data ?? [])
      }

      // 저장 후 최신 데이터 재로드 (캐시 결과 동기화)
      if (savedId) await loadScenario(savedId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ── 삭제 ──────────────────────────────────────────────────────────────────

  function handleDeleteClick() {
    if (!activeId) return
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      deleteTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000)
      return
    }
    // 확인 클릭
    clearTimeout(deleteTimerRef.current ?? undefined)
    setDeleteConfirm(false)
    doDelete()
  }

  async function doDelete() {
    if (!activeId) return
    try {
      const res = await fetch(`/api/sh/pricing-scenarios/${activeId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('삭제 실패')
      toast.success('시나리오가 삭제되었습니다')
      setScenarios((prev) => prev.filter((s) => s.id !== activeId))
      resetToNew()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  // ── 판매채널 등록 핸들러 ───────────────────────────────────────────────────

  function handleRegister(row: PricingItemRow) {
    if (!channelId) {
      toast.error('채널을 먼저 지정하세요')
      return
    }
    // prefill 데이터를 sessionStorage에 저장 (1회용)
    const prefillKey = `pricingPrefill:${Math.random().toString(36).slice(2, 12)}`
    const data = {
      optionId: row.optionId,
      productId: row.productId,
      retailPrice: Math.round(row.result.finalPrice),
    }
    sessionStorage.setItem(prefillKey, JSON.stringify(data))
    router.push(
      `/d/seller-hub/products/listings/new?channelId=${channelId}&fromPricing=1&prefillKey=${encodeURIComponent(prefillKey)}`
    )
  }

  // ── 합계 계산 ──────────────────────────────────────────────────────────────

  const totalRevenue = rows.reduce((acc, r) => acc + r.result.revenueExVat, 0)
  const totalCost = rows.reduce((acc, r) => acc + r.result.totalCost, 0)
  const totalNetProfit = rows.reduce((acc, r) => acc + r.result.netProfit, 0)
  const avgMargin = totalRevenue === 0 ? 0 : totalNetProfit / totalRevenue

  // ── 현재 옵션 id 목록 ─────────────────────────────────────────────────────

  const existingOptionIds = rows.map((r) => r.optionId)

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── 상단: 시나리오 선택 + 저장 ── */}
      <div className="flex items-center gap-2">
        {/* 시나리오 드롭다운 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="min-w-[240px] justify-between"
              disabled={scenariosLoading}
            >
              <span className="truncate">
                {activeId
                  ? (scenarios.find((s) => s.id === activeId)?.name ?? '시나리오')
                  : name.trim()
                    ? `${name} (저장 안 됨)`
                    : '+ 새 시나리오'}
              </span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuItem onClick={resetToNew}>
              <span className="text-muted-foreground">+ 새 시나리오</span>
            </DropdownMenuItem>
            {scenarios.length > 0 && <DropdownMenuSeparator />}
            {scenarios.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => loadScenario(s.id)}
                className="flex flex-col items-start gap-0.5"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {s.itemCount}개 · 순수익 {fmt(s.totalNetProfit)}원 · 마진{' '}
                  {(s.averageMargin * 100).toFixed(1)}%
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        {/* 비교 버튼 */}
        {scenarios.length >= 2 && (
          <Button variant="outline" size="sm" onClick={() => setComparisonOpen(true)}>
            <GitCompare className="mr-1.5 h-4 w-4" />
            비교
          </Button>
        )}

        {/* 삭제 버튼 (기존 시나리오일 때만) */}
        {activeId && (
          <Button
            variant={deleteConfirm ? 'destructive' : 'ghost'}
            size="sm"
            onClick={handleDeleteClick}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            {deleteConfirm ? '정말 삭제?' : '삭제'}
          </Button>
        )}

        {/* 저장 버튼 */}
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save className="mr-1.5 h-4 w-4" />
          {saving ? '저장 중...' : activeId ? '업데이트' : '저장'}
        </Button>
      </div>

      {/* ── 시나리오 메타 카드 ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">시나리오 정보</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 시나리오명 */}
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>
              시나리오명 *{' '}
              {nameAuto && rows.length > 0 && (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  (자동 추천)
                </span>
              )}
            </Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameAuto(false) // 사용자가 직접 입력하면 자동 추천 끔
              }}
              placeholder="예: 쿠팡 여름 프로모션"
              maxLength={100}
            />
          </div>

          {/* 채널 */}
          <div className="space-y-1.5">
            <Label>채널</Label>
            <Select
              value={channelId || '__none__'}
              onValueChange={(v) => setChannelId(v === '__none__' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="채널 선택 (선택사항)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">선택 안 함</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* VAT 토글 + 비율 */}
          <div className="space-y-1.5">
            <Label>부가세(VAT)</Label>
            <div className="flex items-center gap-3">
              <Switch
                checked={includeVat}
                onCheckedChange={setIncludeVat}
                aria-label="VAT 포함 여부"
              />
              <span className="text-sm text-muted-foreground">
                {includeVat ? '포함' : '미포함'}
              </span>
              {includeVat && (
                <div className="relative flex items-center">
                  <Input
                    type="number"
                    value={vatRatePct}
                    onChange={(e) => setVatRatePct(Number(e.target.value))}
                    min={0}
                    max={100}
                    className="h-8 w-16 [appearance:textfield] pr-6 text-right text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="pointer-events-none absolute right-2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 메모 */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor={memoId}>메모</Label>
            <Textarea
              id={memoId}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="참고 사항 (선택)"
              maxLength={500}
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── 기본값 설정 (인라인 편집) ── */}
      <PricingDefaultsCard initialDefaults={defaults} onSaved={setDefaults} />

      {/* ── 옵션 입력 테이블 ── */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">옵션 목록</h2>
        <PricingItemsTable
          rows={rows}
          includeVat={includeVat}
          vatRate={vatRatePct / 100}
          onChange={setRows}
          onAddClick={() => setPickerOpen(true)}
          onRegister={handleRegister}
          scenarioChannelId={channelId || null}
        />
      </div>

      {/* ── 합계 카드 ── */}
      {rows.length > 0 && (
        <>
          <Separator />
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">합계 요약</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">총 매출 (VAT 제외)</p>
                  <p className="text-xl font-bold">{fmt(totalRevenue)}원</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">총 비용</p>
                  <p className="text-xl font-bold">{fmt(totalCost)}원</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">총 순수익</p>
                  <p
                    className={`text-xl font-bold ${
                      totalNetProfit >= 0 ? 'text-green-600' : 'text-destructive'
                    }`}
                  >
                    {fmt(totalNetProfit)}원
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">평균 마진율</p>
                  <p
                    className={`text-xl font-bold ${
                      avgMargin >= 0 ? 'text-foreground' : 'text-destructive'
                    }`}
                  >
                    {(avgMargin * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── 시나리오 비교 다이얼로그 ── */}
      <PricingComparisonDialog
        open={comparisonOpen}
        onOpenChange={setComparisonOpen}
        scenarios={scenarios}
      />

      {/* ── 옵션 피커 다이얼로그 ── */}
      <PricingOptionPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={handlePickOption}
        excludeOptionIds={existingOptionIds}
      />
    </div>
  )
}
