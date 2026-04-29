// 마진율 등급 분류 라이브러리

export type Tier = 'good' | 'fair' | 'bad'

export type TierThresholds = {
  platformTargetGood: number // 0~1
  platformTargetFair: number // 0~1
}

/**
 * 마진율을 임계값에 따라 등급으로 분류한다.
 *
 * margin >= good → 'good'
 * margin >= fair → 'fair'
 * else           → 'bad'
 */
export function classifyTier(margin: number, thresholds: TierThresholds): Tier {
  if (margin >= thresholds.platformTargetGood) return 'good'
  if (margin >= thresholds.platformTargetFair) return 'fair'
  return 'bad'
}
