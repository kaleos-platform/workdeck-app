/**
 * 차감 계정(contra) 판정 — 매출환입(수익 차감)·매입환출(비용 차감).
 *
 * 일반 계정: 섹션 = 현금 방향(IN=수입 / OUT=지출). 오분류에도 화면 간 총액이 일치하도록 유지.
 * 차감 계정(isContra): 섹션 = 계정 type(INCOME→수입 / EXPENSE→지출). 반대 방향 거래는 그 섹션에서 음수.
 *   예) 매출환입에 OUT 30 → 수입 −30 (지출 아님). 순현금흐름(수입−지출)은 어느 쪽이든 동일.
 *
 * 순수 모듈(prisma 미사용) — 서버 집계·클라이언트 분류 가드가 함께 쓴다.
 */

export type CashSection = 'IN' | 'OUT'

type ContraCat = { type: string; isContra?: boolean | null }

/** 차감 계정이면 고정 섹션, 아니면 null(현금 방향 따름). */
export function contraSectionOf(cat: ContraCat | null | undefined): CashSection | null {
  if (!cat?.isContra) return null
  if (cat.type === 'INCOME') return 'IN'
  if (cat.type === 'EXPENSE') return 'OUT'
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
 * 분류 가드: 거래 방향에 이 계정을 붙여도 되는가.
 * 일반 계정은 type이 방향과 일치해야 하고, 차감 계정은 반대 방향만 받는다(XOR). 이체 등은 항상 허용.
 */
export function isCategoryAllowedForDirection(cat: ContraCat, direction: CashSection): boolean {
  const natural = cat.type === 'INCOME' ? 'IN' : cat.type === 'EXPENSE' ? 'OUT' : null
  if (!natural) return true
  return (natural === direction) !== !!cat.isContra
}

/**
 * 서버 정책(저장·자동분류): UI 가드보다 느슨하다 — 입금(IN)을 일반 비용 계정에 두는 환불 처리는 기존대로 허용.
 * 막는 것: 출금(OUT)을 일반 수익 계정에(PR #331 실버그), 차감 계정에 자기 방향 거래.
 */
export function violatesDirectionPolicy(cat: ContraCat, direction: CashSection): boolean {
  if (cat.isContra) return !isCategoryAllowedForDirection(cat, direction)
  return cat.type === 'INCOME' && direction === 'OUT'
}
