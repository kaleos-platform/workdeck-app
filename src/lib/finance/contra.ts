/**
 * 수입/지출 섹션 판정 — 환불 처리의 단일 소스.
 *
 * 수익(INCOME) 계정 = 수입 섹션, 비용(EXPENSE) 계정 = 지출 섹션으로 고정한다.
 * 반대 방향 거래(환불)는 원래 계정에 그대로 분류하면 그 섹션에서 음수로 차감된다.
 *   예) 온라인 판매정산에 OUT 30(고객 환불) → 수입 −30 / 광고비에 IN 10(광고비 환급) → 지출 −10.
 * 미분류·이체 등: 섹션 = 현금 방향.
 * 순현금흐름(수입−지출)은 방향 기준과 항상 동일하다.
 *
 * 순수 모듈(prisma 미사용) — 서버 집계·클라이언트가 함께 쓴다.
 */

export type CashSection = 'IN' | 'OUT'

/** 계정으로 고정되는 섹션, 없으면 null(현금 방향 따름). */
export function fixedSectionOf(cat: { type: string } | null | undefined): CashSection | null {
  if (cat?.type === 'INCOME') return 'IN'
  if (cat?.type === 'EXPENSE') return 'OUT'
  return null
}

/** 거래 1건의 집계 섹션과 그 섹션 기준 부호 금액. */
export function cashSection(
  direction: CashSection,
  amount: number,
  fixedSection: CashSection | null | undefined
): { section: CashSection; amount: number } {
  if (!fixedSection) return { section: direction, amount }
  return { section: fixedSection, amount: direction === fixedSection ? amount : -amount }
}
