// 마진율 등급 분류 라이브러리

export type Tier = 'good' | 'fair' | 'bad'

export type TierThresholds = {
  selfMallTargetGood: number // 0~1
  selfMallTargetFair: number // 0~1
  platformTargetGood: number // 0~1
  platformTargetFair: number // 0~1
}

/**
 * 마진율을 채널 유형별 임계값에 따라 등급으로 분류한다.
 *
 * SELF_MALL → 자사몰 임계값 사용
 * 그 외 → 플랫폼 임계값 사용
 *
 * margin >= good → 'good'
 * margin >= fair → 'fair'
 * else           → 'bad'
 */
export function classifyTier(
  margin: number,
  channelType: string | null,
  thresholds: TierThresholds
): Tier {
  const isSelfMall = channelType === 'SELF_MALL'
  const goodThreshold = isSelfMall ? thresholds.selfMallTargetGood : thresholds.platformTargetGood
  const fairThreshold = isSelfMall ? thresholds.selfMallTargetFair : thresholds.platformTargetFair

  if (margin >= goodThreshold) return 'good'
  if (margin >= fairThreshold) return 'fair'
  return 'bad'
}
