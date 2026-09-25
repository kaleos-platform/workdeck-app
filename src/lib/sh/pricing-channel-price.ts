// 가격 시뮬 — 채널 1개의 "현재 설정 판매가"와 헤드라인/프로모션 매트릭스 산출 (단일 소스)
//
// 채널 보드 카드·상단 KPI·조합 한눈에 보기 표가 모두 이 함수를 쓴다.
// (각자 역산하면 광고 제외·스냅·소비자가 클램프 규칙이 어긋나 화면마다 숫자가 달라진다)

import {
  calculateMatrix,
  type Matrix,
  type MatrixBundle,
  type MatrixChannel,
  type MatrixGlobals,
  type MatrixPromotion,
} from '@/lib/sh/pricing-matrix-calc'
import type { TierThresholds } from '@/lib/sh/margin-tier'
import { snapPrice } from '@/lib/sh/price-snap'

const NO_PROMOTION: MatrixPromotion = { type: 'NONE', value: 0 }

export type ChannelPriceInput = {
  bundle: MatrixBundle
  channel: MatrixChannel
  promotion: MatrixPromotion
  globals: MatrixGlobals
  thresholds: TierThresholds
  /** …900 끝자리 올림 */
  snap: boolean
  /** 소비자가 상한. null=상한 없음 */
  retailCap: number | null
  /** 수동 판매가. null=권장가 자동 */
  manualPrice: number | null
}

export type ChannelPriceResult = {
  /** 권장 판매가 (광고 제외 역산 + 스냅, 상한 클램프 전) */
  recommended: number | null
  /** 권장가가 소비자가를 초과해 상한으로 잘렸는지 */
  exceedsRetail: boolean
  /** 현재 설정 판매가 = 수동가(상한 클램프) ?? 권장가(상한 클램프) */
  effectivePrice: number | null
  /** 실채널(광고 포함) × effectivePrice, 프로모션 없음 */
  headline: Matrix | null
  /** 실채널 × effectivePrice × 프로모션. 프로모션 없으면 null */
  promo: Matrix | null
}

export function computeChannelPrice(input: ChannelPriceInput): ChannelPriceResult {
  const { bundle, channel, promotion, globals, thresholds, snap, retailCap, manualPrice } = input
  // 권장가 역산은 광고 제외 — 광고비가 역산 분모에 들어가면 권장가↑→광고비↑ 순환 인플레
  const reco = calculateMatrix({
    bundle: { ...bundle, salePrice: 0 },
    channel: { ...channel, applyAdCost: false },
    promotion: NO_PROMOTION,
    globals,
    thresholds,
  })
  const raw = reco.recommendedRetail.good
  const recommended = raw != null && snap ? snapPrice(raw, 'end900') : raw
  // 판매가는 소비자가를 초과할 수 없음 — 권장가·수동가 모두 상한 클램프
  const exceedsRetail = recommended != null && retailCap != null && recommended > retailCap
  const autoPrice = exceedsRetail ? retailCap : recommended
  const clampedManual =
    manualPrice != null && retailCap != null ? Math.min(manualPrice, retailCap) : manualPrice
  const effectivePrice = clampedManual ?? autoPrice

  if (effectivePrice == null) {
    return { recommended, exceedsRetail, effectivePrice, headline: null, promo: null }
  }
  const at = (p: MatrixPromotion) =>
    calculateMatrix({
      bundle: { ...bundle, salePrice: effectivePrice },
      channel,
      promotion: p,
      globals,
      thresholds,
    })
  return {
    recommended,
    exceedsRetail,
    effectivePrice,
    headline: at(NO_PROMOTION),
    promo: promotion.type === 'NONE' ? null : at(promotion),
  }
}
