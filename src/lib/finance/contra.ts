/**
 * 수입/지출 섹션 판정 + 분류 방향 가드 — 환불 처리의 단일 소스.
 *
 * 섹션 고정(계정 type 섹션, 반대 방향 거래는 그 섹션에서 음수):
 *   - 비용(EXPENSE) 계정 전부: 환불 입금을 원래 비용 계정에 분류 → 그 비용에서 차감.
 *       예) 광고비에 IN 30 → 지출 −30 (수입 아님).
 *   - 수익 차감 계정(INCOME + isContra, 매출환입): 고객 환불 출금 → 수입에서 차감.
 *       예) 매출환입에 OUT 30 → 수입 −30 (지출 아님).
 * 그 외(일반 수익 계정·미분류): 섹션 = 현금 방향. 일반 수익 계정엔 OUT이 붙지 않으므로(가드) 사실상 IN.
 * 순현금흐름(수입−지출)은 어느 쪽이든 동일.
 *
 * 순수 모듈(prisma 미사용) — 서버 집계·클라이언트 분류 가드가 함께 쓴다.
 */

export type CashSection = 'IN' | 'OUT'

type ContraCat = { type: string; isContra?: boolean | null }

/** 섹션이 계정으로 고정되면 그 섹션, 아니면 null(현금 방향 따름). */
export function fixedSectionOf(cat: ContraCat | null | undefined): CashSection | null {
  if (cat?.type === 'EXPENSE') return 'OUT'
  if (cat?.type === 'INCOME' && cat.isContra) return 'IN'
  return null
}

/** 거래 1건의 집계 섹션과 그 섹션 기준 부호 금액. */
export function cashSection(
  direction: CashSection,
  amount: number,
  contraSection: CashSection | null | undefined
): { section: CashSection; amount: number } {
  if (!contraSection) return { section: direction, amount }
  return { section: contraSection, amount: direction === contraSection ? amount : -amount }
}

/**
 * 분류 가드: 거래 방향에 이 계정을 붙여도 되는가(UI·서버·자동분류 공통).
 *   - 일반 비용: 양방향(OUT=지출, IN=환불 차감).
 *   - 일반 수익: IN만 — OUT→수익은 PR #331 실버그(오분류)라 차단.
 *   - 차감 계정: 자연 방향의 반대만(매출환입=OUT). 레거시 매입환출(EXPENSE+isContra)=IN만.
 *   - 이체 등: 항상 허용.
 */
export function isCategoryAllowedForDirection(cat: ContraCat, direction: CashSection): boolean {
  if (cat.type === 'EXPENSE' && !cat.isContra) return true
  const natural = cat.type === 'INCOME' ? 'IN' : cat.type === 'EXPENSE' ? 'OUT' : null
  if (!natural) return true
  return (natural === direction) !== !!cat.isContra
}

/** 서버 저장·자동분류 차단 판정(= 가드 위반). */
export function violatesDirectionPolicy(cat: ContraCat, direction: CashSection): boolean {
  return !isCategoryAllowedForDirection(cat, direction)
}
