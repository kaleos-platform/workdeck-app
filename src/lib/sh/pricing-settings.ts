import type { PricingFullSettings } from '@/components/sh/products/pricing-sim/pricing-defaults-dialog'

/** `/api/sh/settings` 응답 형태 — 전체 15필드가 Partial (일부 미저장 가능) */
export type PricingSettingsRaw = Partial<PricingFullSettings>

/**
 * `GET /api/sh/settings` 응답 → `PricingFullSettings`(15필드) 매핑.
 * 다이얼로그가 PUT으로 전체를 보내므로 비계산 필드(channelFee/shipping/auto*)도
 * 기본값으로 채워 round-trip 보존한다(저장 시 0 덮어쓰기 방지).
 * quick-flow(시뮬레이터)와 목록 페이지 양쪽에서 재사용 — 필드 추가 시 드리프트 방지.
 */
export function mapPricingSettings(
  raw: PricingSettingsRaw | null | undefined
): PricingFullSettings {
  const s = raw ?? {}
  return {
    defaultOperatingCostPct: Number(s.defaultOperatingCostPct ?? 0) || 0,
    defaultAdCostPct: Number(s.defaultAdCostPct ?? 8) || 0,
    defaultPackagingCost: Number(s.defaultPackagingCost ?? 0) || 0,
    defaultChannelFeePct: Number(s.defaultChannelFeePct ?? 0) || 0,
    defaultShippingCost: Number(s.defaultShippingCost ?? 3000) || 0,
    autoApplyChannelFee: s.autoApplyChannelFee ?? false,
    autoApplyAdCost: s.autoApplyAdCost ?? false,
    autoApplyShipping: s.autoApplyShipping ?? false,
    defaultReturnRate: Number(s.defaultReturnRate ?? 0.15),
    defaultReturnShipping: Number(s.defaultReturnShipping ?? 6000) || 0,
    defaultIncludeVat: s.defaultIncludeVat ?? true,
    defaultVatRate: Number(s.defaultVatRate ?? 0.1),
    platformTargetGood: Number(s.platformTargetGood ?? 0.3),
    platformTargetFair: Number(s.platformTargetFair ?? 0.2),
    minimumAcceptableMargin: Number(s.minimumAcceptableMargin ?? 0.12),
  }
}
