/**
 * 재무 관리 Deck — Prisma Decimal 직렬화 헬퍼.
 * Decimal(18,2)/금액은 JS safe-integer 범위(< 9e15) 안이므로 number 변환이 안전하다.
 * 관례: `Number(v.toString())` (sh/pricing-scenarios 라우트와 동일).
 */

type DecimalLike = { toString(): string }

/** Decimal | null | undefined → number (null/undefined → 0). */
export function toNum(v: DecimalLike | number | null | undefined): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  const n = Number(v.toString())
  return Number.isFinite(n) ? n : 0
}

/** Decimal | null → number | null (0과 미설정을 구분해야 할 때). */
export function toNumOrNull(v: DecimalLike | number | null | undefined): number | null {
  if (v == null) return null
  return toNum(v)
}

/** 소수 둘째자리 반올림(원 단위 합산 누적오차 방지). */
export function round2(n: number): number {
  return Number(n.toFixed(2))
}
