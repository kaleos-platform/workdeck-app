// 심리적 가격 반올림 유틸리티 (순수 결정론적 함수)

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type SnapMode = 'end900' | 'end000' | 'none'

// ─── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 심리적 가격 스냅 — price를 mode에 따라 올림한다.
 *
 * - end900: price 이상인 값 중 마지막 3자리가 900인 최솟값으로 올림
 *   예) 24350 → 24900, 24900 → 24900, 24000 → 24900
 *   공식: base = floor(price/1000)*1000 + 900
 *         return base >= price ? base : base + 1000
 *
 * - end000: price 이상인 1000원 단위 최솟값으로 올림 (ceil to nearest 1000)
 *   예) 24350 → 25000, 24000 → 24000
 *
 * - none: 정수 원으로 반올림만 (변환 없음)
 *
 * NaN·음수·비유한 값 → 0 반환
 */
export function snapPrice(price: number, mode: SnapMode): number {
  if (!Number.isFinite(price) || price < 0) return 0

  const rounded = Math.round(price)

  if (mode === 'none') return rounded

  if (mode === 'end000') {
    return Math.ceil(price / 1000) * 1000
  }

  // end900: price 이상이면서 마지막 3자리가 900인 최솟값
  // base = floor(price/1000)*1000 + 900
  const base = Math.floor(price / 1000) * 1000 + 900
  return base >= price ? base : base + 1000
}
