// CTR/CVR/ROAS 계산 공통 엔진 (F008)

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** CTR (클릭률) = 클릭수 / 노출수 × 100, 노출수 0이면 null */
export function calculateCTR(clicks: number, impressions: number): number | null {
  if (impressions === 0) return null
  return round2((clicks / impressions) * 100)
}

/** CVR (전환율) = 주문수(1일) / 클릭수 × 100, 클릭수 0이면 null */
export function calculateCVR(orders1d: number, clicks: number): number | null {
  if (clicks === 0) return null
  return round2((orders1d / clicks) * 100)
}

/** ROAS (광고수익률) = 매출(1일) / 광고비 × 100, 광고비 0이면 null */
export function calculateROAS(revenue1d: number, adCost: number): number | null {
  if (adCost === 0) return null
  return round2((revenue1d / adCost) * 100)
}

/** 참여율 = 참여수 / 노출수 × 100, 노출수 0이면 null */
export function calculateEngagementRate(engagements: number, impressions: number): number | null {
  if (impressions === 0) return null
  return round2((engagements / impressions) * 100)
}
