'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  calculateMatrix,
  suggestFeasibility,
  type MatrixChannel,
} from '@/lib/sh/pricing-matrix-calc'
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
}: Props) {
  const [expanded, setExpanded] = useState(false)

  // 채널 수수료율 (0~1) — 표시용
  const channelFeePct = useMemo(() => {
    const basic = channel.feeRates.find((f) => f.categoryName === '기본') ?? channel.feeRates[0]
    return basic ? Number(basic.ratePercent) / 100 : 0
  }, [channel])

  // 권장 판매가 역산 — salePrice=0 번들로 매트릭스 계산 후 recommendedRetail.good
  const recoMatrix = useMemo(
    () =>
      calculateMatrix({
        bundle: { ...bundle, salePrice: 0 },
        channel,
        promotion: { type: 'NONE', value: 0 },
        globals,
        thresholds,
      }),
    [bundle, channel, globals, thresholds]
  )
  const rawRecommended = recoMatrix.recommendedRetail.good
  const recommended =
    rawRecommended != null && snap ? snapPrice(rawRecommended, 'end900') : rawRecommended

  // 소비자가 상한 — 권장가는 소비자가를 초과할 수 없음(항목7).
  // 소비자가 = Σ(컴포넌트 소비자가 × 수량). 0/미입력이면 상한 없음(null).
  const retailCap = useMemo(() => {
    const sum = bundle.components.reduce((s, c) => s + (c.retailPrice ?? 0) * c.quantity, 0)
    return sum > 0 ? sum : null
  }, [bundle])
  // 판별은 미클램프 recommended 기준. 스냅 금지(retailCap=정확 소비자가).
  const exceedsRetail = recommended != null && retailCap != null && recommended > retailCap
  // 상한 클램프값 — 매트릭스·게이지·생성가에 모두 주입(표시가와 불일치 방지).
  const effectiveRecommended = exceedsRetail ? retailCap : recommended

  // 권장가 기준 매트릭스 (프로모션 NONE) — 헤드라인 마진·스택바·민감도 차트 소스.
  // 헤드라인은 항상 "권장가에서 목표 마진 달성" 상태를 보여야 하므로 프로모션 미적용.
  const headlineMatrix = useMemo(() => {
    if (effectiveRecommended == null) return null
    return calculateMatrix({
      bundle: { ...bundle, salePrice: effectiveRecommended },
      channel,
      promotion: { type: 'NONE', value: 0 },
      globals,
      thresholds,
    })
  }, [effectiveRecommended, bundle, channel, globals, thresholds])

  const cell = headlineMatrix?.cells[0] ?? null

  // ── 프로모션 여력 게이지 ──────────────────────────────────────────────────
  const floorPct = globals.minimumAcceptableMargin
  const maxDiscount = headlineMatrix?.maxDiscountForMinMargin ?? null
  // 프로모션 적용 매트릭스 (실제 promotion) — 게이지 fill·하한 경고 소스.
  const hasPromo = promotion.type !== 'NONE'
  const promoMatrix = useMemo(() => {
    if (effectiveRecommended == null || !hasPromo) return null
    return calculateMatrix({
      bundle: { ...bundle, salePrice: effectiveRecommended },
      channel,
      promotion,
      globals,
      thresholds,
    })
  }, [effectiveRecommended, hasPromo, bundle, channel, promotion, globals, thresholds])
  const promoCell = promoMatrix?.cells[0] ?? null
  const currentDiscount =
    promoCell != null && cell != null && cell.finalPrice > 0
      ? Math.max(0, 1 - promoCell.finalPrice / cell.finalPrice)
      : 0
  const overFloor = promoCell != null && promoCell.margin < floorPct - 0.005
  const headroomAmount =
    maxDiscount != null && cell != null ? Math.max(0, cell.finalPrice * maxDiscount) : 0

  // ── 목표 마진 달성 불가 시 항목별 제안 ─────────────────────────────────────
  // 구조적 불가(recommended==null) 또는 권장가가 소비자가 상한 초과(exceedsRetail).
  // 소비자가(retailCap) 기준으로 광고비·배송비를 얼마까지 낮춰야 목표 달성인지 역산.
  const target = thresholds.platformTargetGood
  const infeasible = recommended == null || exceedsRetail
  const suggestion = useMemo(() => {
    if (!infeasible || retailCap == null) return null
    return suggestFeasibility(
      { bundle, channel, promotion: { type: 'NONE', value: 0 }, globals, thresholds },
      retailCap,
      target
    )
  }, [infeasible, retailCap, bundle, channel, globals, thresholds, target])

  // 제안 블록 렌더 (광고·배송 레버 각각, 해당 비용 존재 시에만)
  const suggestionBlock =
    suggestion && (suggestion.ad || suggestion.shipping) ? (
      <div className="mt-3 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-snug">
        <p className="font-medium text-amber-800">
          소비자가 ₩{fmt(retailCap!)} 기준 목표 마진 {(target * 100).toFixed(0)}% 달성 제안
        </p>
        {suggestion.ad &&
          (suggestion.ad.achievable ? (
            <p className="text-amber-700">
              · 광고비:{' '}
              {suggestion.ad.roasPct != null ? (
                <span className="font-semibold tabular-nums">
                  ROAS {suggestion.ad.roasPct}% 이상
                </span>
              ) : (
                <span className="font-semibold">광고 제거(0%)</span>
              )}
              {suggestion.ad.adCostPct != null && (
                <span className="text-amber-600">
                  {' '}
                  (광고비율 {(suggestion.ad.adCostPct * 100).toFixed(1)}% 이하)
                </span>
              )}
            </p>
          ) : (
            <p className="text-amber-700">· 광고비를 없애도 목표 마진에 도달할 수 없습니다.</p>
          ))}
        {suggestion.shipping &&
          (suggestion.shipping.achievable ? (
            <p className="text-amber-700">
              · 배송비:{' '}
              {suggestion.shipping.type === 'FIXED' ? (
                <span className="font-semibold tabular-nums">
                  ₩{fmt(suggestion.shipping.feeWon!)} 이하로 조정
                </span>
              ) : (
                <span className="font-semibold tabular-nums">
                  {(suggestion.shipping.feePct! * 100).toFixed(1)}% 이하로 조정
                </span>
              )}
            </p>
          ) : (
            <p className="text-amber-700">· 배송비를 없애도 목표 마진에 도달할 수 없습니다.</p>
          ))}
      </div>
    ) : null

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
        {suggestionBlock}
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
            권장 판매가{exceedsRetail ? ' (소비자가 상한)' : ''}
          </p>
          {/* 항목4: 판매가 우측에 소비자가 대비 할인율 배지 */}
          <div className="flex items-center justify-end gap-2">
            <p className="text-2xl font-bold tabular-nums">₩{fmt(cell.finalPrice)}</p>
            {retailCap != null && cell.finalPrice > 0 && (
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[11px] font-semibold text-emerald-700 tabular-nums"
                title="소비자가 대비 할인율"
              >
                −{Math.round(Math.max(0, (retailCap - cell.finalPrice) / retailCap) * 100)}%
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            <Badge
              variant="outline"
              className={`px-1.5 py-0 text-[11px] ${tierBadgeClass(cell.tier)}`}
            >
              {exceedsRetail ? '' : '✓ '}
              {(cell.margin * 100).toFixed(1)}%{exceedsRetail ? ' (소비자가 기준)' : ''}
            </Badge>
          </div>
          {exceedsRetail && (
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-medium text-amber-600">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              목표 마진 달성 불가
            </div>
          )}
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
      {/* 항목7: 소비자가 상한 초과(목표 미달) 시 항목별 제안 */}
      {exceedsRetail && suggestionBlock}

      {/* 비용 구성 스택바 */}
      <div className="mt-4">
        <PricingCostBar cell={cell} />
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
