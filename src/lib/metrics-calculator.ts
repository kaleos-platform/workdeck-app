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

// ─── 통계 유의성 임계 (분석 판정용) ────────────────────────────────────────────
// "광고비를 썼는데 전환이 0" 같은 판정은 표본(클릭/노출) 또는 지출이 충분해야 신뢰 가능.
// 클릭 1~2회·수십원 지출 노이즈를 비효율로 오판정하지 않도록 하한을 둔다.
// 단, 지출(광고비)이 크면 클릭이 적어도(고CPC) 실제 낭비이므로 광고비 하한도 함께 본다.
// 기본값은 보수적이며, 향후 설정/AnalysisRule로 조정 가능하도록 인자로 노출.
export const MIN_SIGNIFICANT_CLICKS = 10
export const MIN_SIGNIFICANT_IMPRESSIONS = 100
export const MIN_SIGNIFICANT_ADCOST = 1000 // 원. 이 이상 지출·0전환이면 표본 무관 실낭비로 간주

/**
 * 판정에 쓸 만큼 표본/지출이 충분한지 여부.
 * 클릭·노출·광고비 하한 중 하나라도 만족하면 유의미한 신호로 본다.
 * - 클릭/노출 하한: 통계적 표본 충분성 (전환율/클릭률 판정 신뢰)
 * - 광고비 하한: 고CPC·저클릭이라도 실제 지출된 낭비를 놓치지 않기 위함
 */
export function hasSignificantSample(
  clicks: number,
  impressions: number,
  adCost: number = 0,
  minClicks: number = MIN_SIGNIFICANT_CLICKS,
  minImpressions: number = MIN_SIGNIFICANT_IMPRESSIONS,
  minAdCost: number = MIN_SIGNIFICANT_ADCOST
): boolean {
  return clicks >= minClicks || impressions >= minImpressions || adCost >= minAdCost
}
