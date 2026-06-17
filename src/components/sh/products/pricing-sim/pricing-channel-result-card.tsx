'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { calculateMatrix } from '@/lib/sh/pricing-matrix-calc'
import type {
  MatrixBundle,
  MatrixChannel,
  MatrixPromotion,
  MatrixGlobals,
} from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { snapPrice } from '@/lib/sh/price-snap'
import { PricingMatrix } from './pricing-matrix'
import { PricingSensitivityChart } from './pricing-sensitivity-chart'

// ─── 타입 ──────────────────────────────────────────────────────────────────────

type Props = {
  channel: MatrixChannel
  bundle: MatrixBundle
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
  onSetSalePrice: (price: number) => void
  onRemove: () => void
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

function tierColor(tier: 'good' | 'fair' | 'bad'): string {
  if (tier === 'good') return 'text-emerald-600'
  if (tier === 'fair') return 'text-amber-600'
  return 'text-destructive'
}

function tierLabel(tier: 'good' | 'fair' | 'bad'): string {
  if (tier === 'good') return '양호'
  if (tier === 'fair') return '보통'
  return '미달'
}

function tierBadgeClass(tier: 'good' | 'fair' | 'bad'): string {
  if (tier === 'good') return 'border-emerald-300 text-emerald-700'
  if (tier === 'fair') return 'border-amber-300 text-amber-700'
  return 'border-destructive/50 text-destructive'
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────────────

/**
 * 채널별 라이브 결과 카드
 * - 현재 판매가 기준 마진율 (프로모션 미적용 / 적용 병렬 표시)
 * - 추천가 칩 (클릭 시 판매가 설정)
 * - 접힘/펼침: 20컬럼 매트릭스 + 민감도 차트
 */
export function ChannelResultCard({
  channel,
  bundle,
  promotion,
  globals,
  thresholds,
  onSetSalePrice,
  onRemove,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  // 프로모션 없는 기준 매트릭스 — 슬라이더 틱마다 재계산되므로 메모이제이션
  const matrixNone = useMemo(
    () =>
      calculateMatrix({
        bundle,
        channel,
        promotion: { type: 'NONE', value: 0 },
        globals,
        thresholds,
      }),
    [bundle, channel, globals, thresholds]
  )

  // 프로모션 적용 매트릭스 (NONE이면 null)
  const hasActivePromo = promotion.type !== 'NONE'
  const matrixPromo = useMemo(
    () =>
      hasActivePromo ? calculateMatrix({ bundle, channel, promotion, globals, thresholds }) : null,
    [hasActivePromo, bundle, channel, promotion, globals, thresholds]
  )

  // cells[0] = 0% 할인 (현재 판매가 그대로)
  const cellNone = matrixNone.cells[0]
  const cellPromo = matrixPromo?.cells[0] ?? null

  const { recommendedRetail, targetAchievableUnderPromotion, maxDiscountForMinMargin } = matrixNone

  // ── 할인 여력 게이지 ───────────────────────────────────────────────────────
  // 현재 판매가 기준 마진 하한(minimumAcceptableMargin) 도달 전까지 가능한 최대 할인폭.
  // maxDiscountForMinMargin은 salePrice 대비 비율 — 현재 프로모션 할인 깊이와 같은 분모.
  const floorPct = globals.minimumAcceptableMargin
  // 현재 프로모션 할인 깊이 (salePrice 대비). cellNone.finalPrice = salePrice(0% 컬럼).
  const currentDiscount =
    cellPromo != null && cellNone.finalPrice > 0
      ? Math.max(0, 1 - cellPromo.finalPrice / cellNone.finalPrice)
      : 0
  // 마진 하한 한계 = maxDiscountForMinMargin (할인 여력 없음이면 null)
  const headroomDiscount = maxDiscountForMinMargin
  // 게이지 도메인 — 0 나눗셈/빈 게이지 방지
  const gaugeDomain = Math.max(headroomDiscount ?? 0, currentDiscount, 0.05)
  // 하한 초과 여부 — 프로모션 적용 마진이 하한 미달 (good 목표가 아닌 floor 기준)
  const overFloor = cellPromo != null && cellPromo.margin < floorPct - 0.005
  // 하한까지 남은 할인 여력 금액 (salePrice 기준)
  const headroomAmount =
    headroomDiscount != null ? Math.max(0, cellNone.finalPrice * headroomDiscount) : 0

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between border-b px-4 pt-3 pb-2">
        <span className="text-sm font-semibold">{channel.name}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label={`${channel.name} 채널 제거`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* 마진 결과 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {/* 프로모션 미적용 마진 */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">마진</span>
            <span className={`text-base font-bold tabular-nums ${tierColor(cellNone.tier)}`}>
              {(cellNone.margin * 100).toFixed(1)}%
            </span>
            <Badge
              variant="outline"
              className={`px-1.5 py-0 text-[10px] ${tierBadgeClass(cellNone.tier)}`}
            >
              {tierLabel(cellNone.tier)}
            </Badge>
          </div>

          {/* 프로모션 적용 마진 (병렬) */}
          {cellPromo && (
            <>
              <span className="text-xs text-muted-foreground">→ 프로모션 적용</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-base font-bold tabular-nums ${tierColor(cellPromo.tier)}`}>
                  {(cellPromo.margin * 100).toFixed(1)}%
                </span>
                <Badge
                  variant="outline"
                  className={`px-1.5 py-0 text-[10px] ${tierBadgeClass(cellPromo.tier)}`}
                >
                  {tierLabel(cellPromo.tier)}
                </Badge>
              </div>
            </>
          )}

          {/* 순수익 */}
          <span className="ml-auto text-xs text-muted-foreground">
            순수익{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {fmt(cellNone.netProfit)}원
            </span>
          </span>
        </div>

        {/* 목표 마진 미달 경고 */}
        {hasActivePromo && !targetAchievableUnderPromotion && (
          <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>이 프로모션에선 목표 마진 미달</span>
          </div>
        )}

        {/* 추천가 칩 */}
        {(recommendedRetail.good != null ||
          recommendedRetail.fair != null ||
          recommendedRetail.min != null) && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">추천 판매가 (클릭 시 적용)</p>
            <div className="flex flex-wrap gap-1.5">
              {recommendedRetail.good != null && (
                <>
                  <button
                    type="button"
                    onClick={() => onSetSalePrice(recommendedRetail.good!)}
                    className="rounded p-0"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer text-emerald-700 hover:bg-emerald-50"
                    >
                      good {fmt(recommendedRetail.good)}원
                    </Badge>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetSalePrice(snapPrice(recommendedRetail.good!, 'end900'))}
                    className="rounded p-0"
                  >
                    <Badge
                      variant="outline"
                      className="cursor-pointer text-emerald-700 hover:bg-emerald-50"
                    >
                      good {fmt(snapPrice(recommendedRetail.good, 'end900'))}원 (…900)
                    </Badge>
                  </button>
                </>
              )}
              {recommendedRetail.fair != null && (
                <button
                  type="button"
                  onClick={() => onSetSalePrice(recommendedRetail.fair!)}
                  className="rounded p-0"
                >
                  <Badge
                    variant="outline"
                    className="cursor-pointer text-amber-700 hover:bg-amber-50"
                  >
                    fair {fmt(recommendedRetail.fair)}원
                  </Badge>
                </button>
              )}
              {recommendedRetail.min != null && (
                <button
                  type="button"
                  onClick={() => onSetSalePrice(recommendedRetail.min!)}
                  className="rounded p-0"
                >
                  <Badge
                    variant="outline"
                    className="cursor-pointer text-muted-foreground hover:bg-muted"
                  >
                    min {fmt(recommendedRetail.min)}원
                  </Badge>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 할인 여력 게이지 — 마진 하한 도달 전 최대 할인폭 */}
        <div className="space-y-1.5 rounded-md border bg-muted/20 px-3 py-2.5">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted-foreground">
              현재 할인{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {(currentDiscount * 100).toFixed(0)}%
              </span>
            </span>
            <span className="text-muted-foreground">
              하한 한계{' '}
              {headroomDiscount != null ? (
                <span className="font-semibold text-destructive tabular-nums">
                  −{(headroomDiscount * 100).toFixed(0)}%
                </span>
              ) : (
                <span className="font-semibold text-destructive">여력 없음</span>
              )}
            </span>
          </div>
          {/* 게이지 트랙 */}
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                overFloor ? 'bg-destructive' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, (currentDiscount / gaugeDomain) * 100)}%` }}
            />
            {headroomDiscount != null && (
              <div
                className="absolute inset-y-[-2px] w-0.5 rounded-full bg-foreground"
                style={{ left: `${Math.min(100, (headroomDiscount / gaugeDomain) * 100)}%` }}
                aria-hidden
              />
            )}
          </div>
          {/* 안내 / 경고 */}
          <p className="text-[11px] leading-snug">
            {headroomDiscount == null ? (
              <span className="text-destructive">
                0% 할인에서도 마진 하한 {(floorPct * 100).toFixed(0)}% 미달 — 공급가·수수료를
                확인하세요.
              </span>
            ) : overFloor ? (
              <span className="text-destructive">
                ⚠ 마진 하한 {(floorPct * 100).toFixed(0)}% 미달 — 할인폭을{' '}
                {((currentDiscount - headroomDiscount) * 100).toFixed(0)}% 줄이세요.
              </span>
            ) : (
              <span className="text-muted-foreground">
                마진 하한 {(floorPct * 100).toFixed(0)}% 도달 전{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  −{fmt(headroomAmount)}원 (−{(headroomDiscount * 100).toFixed(0)}%)
                </span>
                까지 할인 가능
              </span>
            )}
          </p>
        </div>

        {/* 접힘/펼침 토글 */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUp className="mr-1 h-3.5 w-3.5" />
              매트릭스 / 민감도 접기
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3.5 w-3.5" />
              매트릭스 / 민감도 보기
            </>
          )}
        </Button>

        {/* 펼침: 매트릭스 + 민감도 차트 */}
        {expanded && (
          <div className="space-y-4 border-t pt-3">
            <PricingMatrix
              bundle={bundle}
              channel={channel}
              promotion={promotion}
              globals={globals}
              thresholds={thresholds}
            />
            <PricingSensitivityChart matrix={matrixNone} channelName={channel.name} />
          </div>
        )}
      </div>
    </div>
  )
}
