'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { calculateMatrix, type MatrixChannel } from '@/lib/sh/pricing-matrix-calc'
import type { MatrixBundle, MatrixPromotion, MatrixGlobals } from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { snapPrice } from '@/lib/sh/price-snap'

import { PricingCostBar } from './pricing-cost-bar'
import { PricingMatrix } from './pricing-matrix'
import { PricingSensitivityChart } from './pricing-sensitivity-chart'

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

function tierBadgeClass(tier: 'good' | 'fair' | 'bad'): string {
  if (tier === 'good') return 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (tier === 'fair') return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-destructive/40 bg-destructive/10 text-destructive'
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type Props = {
  channel: MatrixChannel
  /** salePrice 없이 — 권장가를 이 카드에서 역산해 채운다 */
  bundle: MatrixBundle
  /** 채널 광고비율 (0~1) — 표시용 */
  adPct: number
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
  /** …900 스냅 적용 여부 */
  snap: boolean
  /** 채널별 판매채널 상품 생성 (권장가 기준) */
  onCreate?: (channel: MatrixChannel, recommendedPrice: number) => void
  creating?: boolean
  canCreate?: boolean
  /** 광고 ROAS를 이 보드에서 조정 — ChOverride(applyAdCost·adPct) 갱신 콜백 */
  onAdChange?: (patch: { applyAdCost?: boolean; adPct?: number }) => void
  /** 판매가 수동조정값 (null=권장가 자동). 부모가 시나리오 저장/복원 위해 관리 */
  manualPrice: number | null
  /** 판매가 수동조정 변경 콜백 (null=권장가로 리셋) */
  onManualPriceChange: (v: number | null) => void
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

/**
 * 채널별 마진 보드 카드 (스크린샷 시안).
 * 목표 마진율로 역산한 권장 판매가를 헤드라인으로, 비용 구성 스택바 + 프로모션 여력 게이지.
 * 펼치면 20컬럼 매트릭스 + 민감도 차트.
 */
export function PricingChannelBoardCard({
  channel,
  bundle,
  adPct,
  promotion,
  globals,
  thresholds,
  snap,
  onCreate,
  creating,
  canCreate,
  onAdChange,
  manualPrice,
  onManualPriceChange,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  // 채널 수수료율 (0~1) — 표시용
  const channelFeePct = useMemo(() => {
    const basic = channel.feeRates.find((f) => f.categoryName === '기본') ?? channel.feeRates[0]
    return basic ? Number(basic.ratePercent) / 100 : 0
  }, [channel])

  // 광고 제외 채널 — 권장가 역산·광고 전 마진 비교에 사용.
  // (광고비가 역산 분모에 들어가면 권장가↑→광고비↑ 순환 인플레 발생하므로 제외)
  const adlessChannel = useMemo<MatrixChannel>(
    () => ({ ...channel, applyAdCost: false }),
    [channel]
  )
  // 권장 판매가 역산 — 광고 제외 기준(salePrice=0 번들) recommendedRetail.good
  const recoMatrix = useMemo(
    () =>
      calculateMatrix({
        bundle: { ...bundle, salePrice: 0 },
        channel: adlessChannel,
        promotion: { type: 'NONE', value: 0 },
        globals,
        thresholds,
      }),
    [bundle, adlessChannel, globals, thresholds]
  )
  const rawRecommended = recoMatrix.recommendedRetail.good
  const recommended =
    rawRecommended != null && snap ? snapPrice(rawRecommended, 'end900') : rawRecommended

  // 소비자가 상한 — 자동 권장가는 소비자가를 초과할 수 없음.
  // 소비자가 = Σ(컴포넌트 소비자가 × 수량). 0/미입력이면 상한 없음(null).
  const retailCap = useMemo(() => {
    const sum = bundle.components.reduce((s, c) => s + (c.retailPrice ?? 0) * c.quantity, 0)
    return sum > 0 ? sum : null
  }, [bundle])
  const exceedsRetail = recommended != null && retailCap != null && recommended > retailCap
  // 자동 권장가(상한 클램프). 수동가는 클램프 없이 사용자 값 그대로.
  const autoPrice = exceedsRetail ? retailCap : recommended
  const effectivePrice = manualPrice ?? autoPrice
  const isManual = manualPrice != null

  // 헤드라인 매트릭스 — 실채널(광고 적용) × effectivePrice. 마진은 광고 반영(에로전).
  const headlineMatrix = useMemo(() => {
    if (effectivePrice == null) return null
    return calculateMatrix({
      bundle: { ...bundle, salePrice: effectivePrice },
      channel,
      promotion: { type: 'NONE', value: 0 },
      globals,
      thresholds,
    })
  }, [effectivePrice, bundle, channel, globals, thresholds])

  const cell = headlineMatrix?.cells[0] ?? null

  const target = thresholds.platformTargetGood

  // ── 프로모션 여력 게이지 ──────────────────────────────────────────────────
  const floorPct = globals.minimumAcceptableMargin
  const maxDiscount = headlineMatrix?.maxDiscountForMinMargin ?? null
  // 프로모션 적용 매트릭스 (실제 promotion) — 게이지 fill·하한 경고 소스.
  const hasPromo = promotion.type !== 'NONE'
  const promoMatrix = useMemo(() => {
    if (effectivePrice == null || !hasPromo) return null
    return calculateMatrix({
      bundle: { ...bundle, salePrice: effectivePrice },
      channel,
      promotion,
      globals,
      thresholds,
    })
  }, [effectivePrice, hasPromo, bundle, channel, promotion, globals, thresholds])
  const promoCell = promoMatrix?.cells[0] ?? null
  const currentDiscount =
    promoCell != null && cell != null && cell.finalPrice > 0
      ? Math.max(0, 1 - promoCell.finalPrice / cell.finalPrice)
      : 0
  const overFloor = promoCell != null && promoCell.margin < floorPct - 0.005
  const headroomAmount =
    maxDiscount != null && cell != null ? Math.max(0, cell.finalPrice * maxDiscount) : 0

  // 판매가 조정 슬라이더 범위 — 권장가 주변(없으면 소비자가 기준).
  const sliderBase = recommended ?? retailCap ?? 10000
  const sliderMin = Math.max(0, Math.round((sliderBase * 0.5) / 100) * 100)
  const sliderMax = Math.round((retailCap ?? sliderBase * 1.5) / 100) * 100

  // 광고 ROAS 컨트롤 핸들러 (보드에서 조정)
  const roasPct = adPct > 0 ? Math.round(100 / adPct) : 0

  // ── 권장가 역산 불가 (구조적) ──────────────────────────────────────────────
  if (recommended == null || cell == null) {
    return (
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-card)] p-5">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold">{channel.name}</span>
          <span className="text-xs text-muted-foreground">
            수수료 {(channelFeePct * 100).toFixed(1)}% ·{' '}
            {channel.applyAdCost && adPct > 0 ? `ROAS ${Math.round(100 / adPct)}%` : '광고 없음'} ·
            PG {((channel.paymentFeeIncluded ? 0 : channel.paymentFeePct) * 100).toFixed(0)}%
          </span>
        </div>
        <div className="mt-3 flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          목표 마진 {(thresholds.platformTargetGood * 100).toFixed(0)}% 달성 불가 — 수수료·원가가
          너무 높습니다.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-card)] p-5 shadow-sm">
      {/* 헤더 행: 채널명·수수료 요약 / 권장가·마진율 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">{channel.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            수수료 {(channelFeePct * 100).toFixed(1)}% ·{' '}
            {channel.applyAdCost && adPct > 0 ? `ROAS ${Math.round(100 / adPct)}%` : '광고 없음'} ·
            PG {((channel.paymentFeeIncluded ? 0 : channel.paymentFeePct) * 100).toFixed(0)}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground">
            {isManual ? '판매가 (수동)' : `권장 판매가${exceedsRetail ? ' (소비자가 상한)' : ''}`}
          </p>
          {/* 항목1: 판매가 우측 소비자가 대비 할인율 — 배경 없는 텍스트(마진 배지와 스타일 구분) */}
          <div className="flex items-center justify-end gap-2">
            <p className="text-2xl font-bold tabular-nums">₩{fmt(cell.finalPrice)}</p>
            {retailCap != null && cell.finalPrice > 0 && (
              <span
                className="text-xs font-semibold text-emerald-600 tabular-nums"
                title="소비자가 대비 할인율"
              >
                −{Math.round(Math.max(0, (retailCap - cell.finalPrice) / retailCap) * 100)}%
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            {!exceedsRetail &&
              (cell.margin < floorPct ? (
                <span className="text-[10px] font-medium text-destructive">하한 미달</span>
              ) : cell.margin < target ? (
                <span className="text-[10px] font-medium text-amber-700">목표 미달</span>
              ) : null)}
            <Badge
              variant="outline"
              className={`px-1.5 py-0 text-[11px] ${tierBadgeClass(cell.tier)}`}
            >
              {exceedsRetail ? '' : '✓ '}
              {(cell.margin * 100).toFixed(1)}%{exceedsRetail ? ' (소비자가 기준)' : ''}
            </Badge>
          </div>
          {/* 항목3: "목표 마진 달성 불가"는 아래 제안 블록 제목으로 이동(중복 제거) */}
          {/* 항목5: 공급가만 유지(마진 금액·마진율은 스택바·배지와 중복 → 제거) + 툴팁 설명 */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="mt-0.5 cursor-default text-[10px] text-muted-foreground tabular-nums underline decoration-dotted underline-offset-2">
                  공급가(VAT 제외) ₩{fmt(cell.revenue)}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-xs">
                <p>판매가에서 VAT를 제외한 실매출액입니다.</p>
                <p className="text-muted-foreground">마진율(이익율) 계산의 분모로 쓰입니다.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {/* 판매가 조정 + 광고 ROAS — 좌우 배치, 동일 구조(헤더행·슬라이더·min/max)로 통일 */}
      <div className="mt-4 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-muted)] px-3 py-2.5">
        <div className="grid grid-cols-2 gap-x-4">
          {/* 좌: 판매가 조정 (입력 + 슬라이더) */}
          <div>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-medium">판매가 조정</span>
              <div className="flex items-center gap-1">
                {isManual && (
                  <button
                    type="button"
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => onManualPriceChange(null)}
                  >
                    권장가
                  </button>
                )}
                <div className="relative flex items-center">
                  <Input
                    type="number"
                    value={effectivePrice != null ? String(Math.round(effectivePrice)) : ''}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      onManualPriceChange(v > 0 ? v : null)
                    }}
                    step={100}
                    min={0}
                    className="h-7 w-24 [appearance:textfield] bg-background pr-5 text-right text-sm tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="pointer-events-none absolute right-1.5 text-[11px] text-muted-foreground">
                    ₩
                  </span>
                </div>
              </div>
            </div>
            <Slider
              className="mt-2 [&_[data-slot=slider-track]]:bg-background"
              min={sliderMin}
              max={sliderMax}
              step={100}
              value={[Math.min(sliderMax, Math.max(sliderMin, effectivePrice ?? sliderMin))]}
              onValueChange={(v) => onManualPriceChange(v[0])}
            />
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground tabular-nums">
              <span>₩{fmt(sliderMin)}</span>
              {recommended != null && <span>권장 ₩{fmt(recommended)}</span>}
              <span>₩{fmt(sliderMax)}</span>
            </div>
          </div>

          {/* 우: 광고 ROAS (보드에서 조정) — 판매가 불변, 마진만 감소. 판매가 조정과 동일 구조 */}
          {onAdChange && (
            <div className="border-l border-[var(--ps-border)] pl-4">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium">광고 ROAS</span>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex items-center">
                    <Input
                      type="number"
                      value={roasPct > 0 ? String(roasPct) : ''}
                      onChange={(e) => {
                        const r = Number(e.target.value)
                        onAdChange({ adPct: r > 0 ? 100 / r : 0 })
                      }}
                      step={10}
                      min={0}
                      disabled={!channel.applyAdCost}
                      className="h-7 w-16 [appearance:textfield] bg-background pr-5 text-right text-sm tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="pointer-events-none absolute right-1.5 text-[11px] text-muted-foreground">
                      %
                    </span>
                  </div>
                  <Switch
                    checked={channel.applyAdCost}
                    onCheckedChange={(v) => onAdChange({ applyAdCost: v })}
                  />
                </div>
              </div>
              <Slider
                className="mt-2 [&_[data-slot=slider-track]]:bg-background"
                min={100}
                max={1000}
                step={50}
                disabled={!channel.applyAdCost}
                value={[Math.min(1000, Math.max(100, roasPct || 100))]}
                onValueChange={(v) => onAdChange({ adPct: v[0] > 0 ? 100 / v[0] : 0 })}
              />
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground tabular-nums">
                <span>100%</span>
                <span>1000%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 비용 구성 스택바 — 프로모션 적용 시 프로모션 후(promoCell) 비용/마진 + 할인 세그먼트 */}
      <div className="mt-4">
        <PricingCostBar
          cell={hasPromo && promoCell ? promoCell : cell}
          discount={hasPromo && promoCell ? Math.max(0, cell.finalPrice - promoCell.finalPrice) : 0}
          basePrice={cell.finalPrice}
        />
      </div>

      {/* 프로모션 여력 */}
      <div className="mt-4 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-muted)] px-3 py-2.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="font-medium">프로모션 여력</span>
          <span className="text-muted-foreground">
            {hasPromo ? (
              <>
                현재 할인{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {(currentDiscount * 100).toFixed(0)}%
                </span>
              </>
            ) : (
              '현재 할인 0%'
            )}
            {maxDiscount != null ? (
              <>
                {' · '}하한 한계{' '}
                <span className="font-semibold text-destructive tabular-nums">
                  −{(maxDiscount * 100).toFixed(0)}%
                </span>
              </>
            ) : (
              <span className="ml-1 font-semibold text-destructive">여력 없음</span>
            )}
          </span>
        </div>
        {/* 항목6: 여력 게이지 그래프 제거 — 텍스트만으로 설명 */}
        <p className="mt-1.5 text-[11px] leading-snug">
          {maxDiscount == null ? (
            <span className="text-destructive">
              0% 할인에서도 마진 하한 {(floorPct * 100).toFixed(0)}% 미달
            </span>
          ) : overFloor ? (
            <span className="text-destructive">
              ⚠ 마진 하한 {(floorPct * 100).toFixed(0)}% 미달 — 할인폭을{' '}
              {((currentDiscount - maxDiscount) * 100).toFixed(0)}% 줄이세요.
            </span>
          ) : (
            <span className="text-muted-foreground">
              마진 하한 {(floorPct * 100).toFixed(0)}% 도달 전{' '}
              <span className="font-semibold text-foreground tabular-nums">
                −₩{fmt(headroomAmount)} (−{(maxDiscount * 100).toFixed(0)}%)
              </span>
              까지 할인 가능
            </span>
          )}
        </p>
      </div>

      {/* 액션 행 */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 flex-1 text-xs text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="mr-1 h-3.5 w-3.5" /> 매트릭스 / 민감도 접기
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3.5 w-3.5" /> 매트릭스 / 민감도 보기
            </>
          )}
        </Button>
        {onCreate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={!canCreate || creating}
            onClick={() => onCreate(channel, cell.finalPrice)}
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? '생성 중...' : '채널 상품 생성'}
          </Button>
        )}
      </div>

      {/* 펼침: 매트릭스 + 민감도 */}
      {expanded && (
        <div className="mt-3 space-y-4 border-t border-[var(--ps-border)] pt-3">
          <PricingMatrix
            bundle={{ ...bundle, salePrice: cell.finalPrice }}
            channel={channel}
            promotion={promotion}
            globals={globals}
            thresholds={thresholds}
          />
          {/* cell != null 가드를 통과했으므로 headlineMatrix 도 non-null */}
          <PricingSensitivityChart matrix={headlineMatrix!} channelName={channel.name ?? ''} />
        </div>
      )}
    </div>
  )
}
