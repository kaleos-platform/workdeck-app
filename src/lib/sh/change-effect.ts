// 상품명·검색어 변경 효과 — 변경 전후 창 계산(순수)과 순위 중앙값.
//
// 변경일 D(KST) 기준: before = [D-14, D-1], after = [D+1, min(D+14, 마지막 집계완료일)].
// 변경 당일은 어느 쪽에도 넣지 않는다(변경 시각이 하루 중 어디인지 모르므로).

import { addDaysYmd } from '@/lib/sh/sales-analytics'

export const EFFECT_WINDOW_DAYS = 14
/** NOT_IN_TOP100 은 중앙값 계산에서 101위로 본다. 표시 계층이 "100위 밖"으로 보여준다. */
export const NOT_IN_TOP_RANK = 101

export type EffectWindows = {
  before: { from: string; to: string }
  after: { from: string; to: string }
  /** after 창에서 실제 관측된 일수(0..14) */
  observedDays: number
  complete: boolean
}

export function computeEffectWindows(changeYmd: string, lastClosedYmd: string): EffectWindows {
  const afterFrom = addDaysYmd(changeYmd, 1)
  const full = addDaysYmd(changeYmd, EFFECT_WINDOW_DAYS)
  const afterTo = full < lastClosedYmd ? full : lastClosedYmd
  const observedDays =
    afterTo < afterFrom
      ? 0
      : Math.round((Date.parse(afterTo) - Date.parse(afterFrom)) / 86_400_000) + 1
  return {
    before: { from: addDaysYmd(changeYmd, -EFFECT_WINDOW_DAYS), to: addDaysYmd(changeYmd, -1) },
    after: { from: afterFrom, to: afterTo },
    observedDays,
    complete: observedDays === EFFECT_WINDOW_DAYS,
  }
}

/** 순위 중앙값. 값이 없으면 null. 짝수 개면 가운데 두 값의 평균. */
export function medianRank(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
