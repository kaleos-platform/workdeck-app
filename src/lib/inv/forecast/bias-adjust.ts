// Bias 보정 계수 계산
//
// prevBias: 직전 계획의 bias% (양수=과예측, 음수=과소예측)
// factor = clamp(1 / (1 + prevBias), 0.7, 1.3)
//
// 예: prevBias=0.20 → 1/1.20 = 0.833 (과예측이었으므로 수량 낮춤)
//     prevBias=-0.15 → 1/0.85 = 1.176 (과소예측이었으므로 수량 높임)
//     null → 1.0 (보정 없음)

const CLAMP_MIN = 0.7
const CLAMP_MAX = 1.3

/**
 * 직전 계획의 bias를 입력받아 보정 계수 반환.
 * @param prevBias - 직전 계획 bias% (null이면 보정 없음 → 1.0 반환)
 */
export function computeBiasAdjust(prevBias: number | null): number {
  if (prevBias === null || !isFinite(prevBias)) return 1.0

  const raw = 1 / (1 + prevBias)
  return clamp(raw, CLAMP_MIN, CLAMP_MAX)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
