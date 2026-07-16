/**
 * 손익계산서/공헌이익 관점 표 구성(순수 함수).
 * 입력 = 계정별 자연부호 net(pnlLeaves): 수입계정 IN:+/OUT:−, 지출계정 OUT:+/IN:−.
 * 자연부호라 환불(반대방향 거래)이 계정 내 상계 → 그룹헤더=Σleaf, 당기순이익=Σ수입−Σ지출=순현금흐름 불변식 성립.
 *
 * 분류(계정 type + 대분류 flowRole + 리프 groupLabel):
 *  - 수입: MERCH_SALES → 매출액 / 그 외 → 영업외수익
 *  - 지출: COGS → 매출원가, OPEX → 판관비(영업), FINANCING_COST·null → 영업외비용
 *  - 영업지출 행태별(공헌이익): groupLabel '변동' → 변동비 / 그 외 → 고정비
 * 미지정·기타는 영업외로 흡수. 브라우저 의존 없음 → 유닛 테스트 대상.
 */
import type { FinFlowRole } from '@/generated/prisma/enums'

export type ProfitView = 'income-statement' | 'contribution'
export type StatementMode = 'group' | 'hierarchy' | 'leaf'
export const VARIABLE_LABEL = '변동'

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export interface PnlLeaf {
  id: string
  name: string
  type: 'INCOME' | 'EXPENSE'
  flowRole: FinFlowRole | null
  groupLabel: string | null
  values: Record<string, number>
}

export interface StatementRow {
  key: string
  label: string
  /** 소계 이익률 라벨(예: "매출총이익률 62%"). */
  marginLabel?: string
  /** 소계 이익률(%) — 강조 색상용. */
  marginPct?: number | null
  values: Record<string, number>
  changePct: number | null
  variant: 'group' | 'leaf' | 'subtotal'
  /** 거래내역 패널 대상(그룹/리프만; 소계는 미선택). */
  selectable?: boolean
  direction?: 'IN' | 'OUT'
  categoryIds?: string[]
  uncategorized?: boolean
}

const isNone = (id: string): boolean => id.startsWith('__none_')

const zero = (buckets: string[]): Record<string, number> =>
  Object.fromEntries(buckets.map((b) => [b, 0]))

const sumLeaves = (leaves: PnlLeaf[], buckets: string[]): Record<string, number> => {
  const out = zero(buckets)
  for (const l of leaves) for (const b of buckets) out[b] = round2(out[b] + (l.values[b] ?? 0))
  return out
}

const combine = (
  a: Record<string, number>,
  b: Record<string, number>,
  buckets: string[],
  sign: 1 | -1
): Record<string, number> =>
  Object.fromEntries(buckets.map((k) => [k, round2((a[k] ?? 0) + sign * (b[k] ?? 0))]))

const changeOf = (values: Record<string, number>, buckets: string[]): number | null => {
  if (buckets.length < 2) return null
  const last = values[buckets[buckets.length - 1]]
  const prev = values[buckets[buckets.length - 2]]
  if (prev === 0) return null
  return round2(((last - prev) / Math.abs(prev)) * 100)
}

/** 소계/매출 = 이익률(%). 매출 ≤ 0 → null. */
const marginPct = (
  subtotal: Record<string, number>,
  revenue: Record<string, number>,
  buckets: string[]
): number | null => {
  const s = buckets.reduce((a, b) => a + subtotal[b], 0)
  const r = buckets.reduce((a, b) => a + revenue[b], 0)
  if (r <= 0) return null
  return Math.round((s / r) * 100)
}

/** 계정 분류 + 버킷별 그룹합·소계 집계(손익계산서/공헌이익/요약 공용). */
function aggregatePnl(pnlLeaves: PnlLeaf[], buckets: string[]) {
  const income = pnlLeaves.filter((l) => l.type === 'INCOME')
  const expense = pnlLeaves.filter((l) => l.type === 'EXPENSE')
  const operating = (l: PnlLeaf) => l.flowRole === 'COGS' || l.flowRole === 'OPEX'

  const merchLeaves = income.filter((l) => l.flowRole === 'MERCH_SALES')
  const nonOpIncomeLeaves = income.filter((l) => l.flowRole !== 'MERCH_SALES')
  const cogsLeaves = expense.filter((l) => l.flowRole === 'COGS')
  const opexLeaves = expense.filter((l) => l.flowRole === 'OPEX')
  const nonOpExpenseLeaves = expense.filter((l) => !operating(l))
  const variableLeaves = expense.filter((l) => operating(l) && l.groupLabel === VARIABLE_LABEL)
  const fixedLeaves = expense.filter((l) => operating(l) && l.groupLabel !== VARIABLE_LABEL)

  const revenue = sumLeaves(merchLeaves, buckets)
  const grossProfit = combine(revenue, sumLeaves(cogsLeaves, buckets), buckets, -1)
  const contributionMargin = combine(revenue, sumLeaves(variableLeaves, buckets), buckets, -1)
  const operatingIncome = combine(grossProfit, sumLeaves(opexLeaves, buckets), buckets, -1)
  const nonOpIncome = sumLeaves(nonOpIncomeLeaves, buckets)
  const nonOpExpense = sumLeaves(nonOpExpenseLeaves, buckets)
  const netIncome = combine(
    combine(operatingIncome, nonOpIncome, buckets, 1),
    nonOpExpense,
    buckets,
    -1
  )
  return {
    merchLeaves,
    nonOpIncomeLeaves,
    cogsLeaves,
    opexLeaves,
    nonOpExpenseLeaves,
    variableLeaves,
    fixedLeaves,
    revenue,
    grossProfit,
    contributionMargin,
    operatingIncome,
    netIncome,
  }
}

/** 관점별 손익계산서 행 구성. */
export function buildPnlStatement(
  pnlLeaves: PnlLeaf[],
  buckets: string[],
  view: ProfitView,
  mode: StatementMode
): StatementRow[] {
  const {
    merchLeaves,
    nonOpIncomeLeaves,
    cogsLeaves,
    opexLeaves,
    nonOpExpenseLeaves,
    variableLeaves,
    fixedLeaves,
    revenue,
    grossProfit,
    contributionMargin,
    operatingIncome,
    netIncome,
  } = aggregatePnl(pnlLeaves, buckets)

  const rows: StatementRow[] = []

  // 그룹(헤더 + 하위 leaf). 단일 leaf 그룹은 "리프명(그룹명)"으로 병합. 빈 그룹은 생략.
  const pushGroup = (label: string, leaves: PnlLeaf[]) => {
    if (leaves.length === 0) return
    const values = sumLeaves(leaves, buckets)
    const direction: 'IN' | 'OUT' = leaves[0].type === 'INCOME' ? 'IN' : 'OUT'
    const catIds = leaves.map((l) => l.id).filter((id) => !isNone(id))
    const uncategorized = leaves.some((l) => isNone(l.id))
    if (leaves.length === 1) {
      rows.push({
        key: `g:${label}`,
        label: `${leaves[0].name} (${label})`,
        values,
        changePct: changeOf(values, buckets),
        variant: 'group',
        selectable: true,
        direction,
        categoryIds: catIds,
        uncategorized,
      })
      return
    }
    rows.push({
      key: `g:${label}`,
      label,
      values,
      changePct: changeOf(values, buckets),
      variant: 'group',
      selectable: true,
      direction,
      categoryIds: catIds,
      uncategorized,
    })
    if (mode === 'group') return
    const sorted = [...leaves].sort(
      (a, b) =>
        buckets.reduce((s, k) => s + b.values[k], 0) - buckets.reduce((s, k) => s + a.values[k], 0)
    )
    for (const l of sorted) {
      rows.push({
        key: `l:${l.id}`,
        label: l.name,
        values: l.values,
        changePct: changeOf(l.values, buckets),
        variant: 'leaf',
        selectable: true,
        direction,
        categoryIds: isNone(l.id) ? [] : [l.id],
        uncategorized: isNone(l.id),
      })
    }
  }

  const pushSubtotal = (
    label: string,
    values: Record<string, number>,
    marginName: string | null
  ) => {
    const pct = marginName ? marginPct(values, revenue, buckets) : null
    rows.push({
      key: `s:${label}`,
      label,
      marginLabel: marginName && pct != null ? `${marginName} ${pct}%` : undefined,
      marginPct: pct,
      values,
      changePct: changeOf(values, buckets),
      variant: 'subtotal',
    })
  }

  if (view === 'income-statement') {
    pushGroup('매출액', merchLeaves)
    pushGroup('매출원가', cogsLeaves)
    pushSubtotal('매출총이익', grossProfit, '매출총이익률')
    pushGroup('판매비와관리비', opexLeaves)
    pushSubtotal('영업이익', operatingIncome, '영업이익률')
  } else {
    pushGroup('매출액', merchLeaves)
    pushGroup('변동비', variableLeaves)
    pushSubtotal('공헌이익', contributionMargin, '공헌이익률')
    pushGroup('고정비', fixedLeaves)
    pushSubtotal('영업이익', operatingIncome, '영업이익률')
  }
  pushGroup('영업외수익', nonOpIncomeLeaves)
  pushGroup('영업외비용', nonOpExpenseLeaves)
  pushSubtotal('당기순이익', netIncome, '순이익률')

  return rows
}

// ─── 요약 지표(전체기간) ──────────────────────────────────────────────────────

export type SafetyStatus = '우수' | '양호' | '보통' | '위험'

export interface PnlSummary {
  revenue: number
  grossProfit: number
  grossMarginRatio: number | null
  contributionMargin: number
  contributionMarginRatio: number | null
  operatingIncome: number
  operatingMarginRatio: number | null
  netIncome: number
  netMarginRatio: number | null
  /** 안전한계율(%) = 영업이익 / 공헌이익 × 100. 공헌이익 ≤ 0 → null. */
  safetyMargin: number | null
  safetyStatus: SafetyStatus | null
}

/** 안전한계율(%) → 상태. 우수 ≥30 / 양호 20~30 / 보통 10~20 / 위험 <10. */
export function safetyStatusOf(safetyMargin: number | null): SafetyStatus | null {
  if (safetyMargin == null) return null
  if (safetyMargin >= 30) return '우수'
  if (safetyMargin >= 20) return '양호'
  if (safetyMargin >= 10) return '보통'
  return '위험'
}

const total = (m: Record<string, number>, buckets: string[]): number =>
  round2(buckets.reduce((a, b) => a + (m[b] ?? 0), 0))

/** 전체기간 요약 — 이익·이익률·안전한계율. pnlLeaves 단일 소스(표와 정합). */
export function buildPnlSummary(pnlLeaves: PnlLeaf[], buckets: string[]): PnlSummary {
  const a = aggregatePnl(pnlLeaves, buckets)
  const revenue = total(a.revenue, buckets)
  const grossProfit = total(a.grossProfit, buckets)
  const contributionMargin = total(a.contributionMargin, buckets)
  const operatingIncome = total(a.operatingIncome, buckets)
  const netIncome = total(a.netIncome, buckets)
  const pct = (v: number): number | null => (revenue > 0 ? Math.round((v / revenue) * 100) : null)
  // 안전한계율 = 영업이익/공헌이익 (단일 가드). = (매출−손익분기점)/매출.
  const safetyMargin =
    contributionMargin > 0 ? round2((operatingIncome / contributionMargin) * 100) : null
  return {
    revenue,
    grossProfit,
    grossMarginRatio: pct(grossProfit),
    contributionMargin,
    contributionMarginRatio: pct(contributionMargin),
    operatingIncome,
    operatingMarginRatio: pct(operatingIncome),
    netIncome,
    netMarginRatio: pct(netIncome),
    safetyMargin,
    safetyStatus: safetyStatusOf(safetyMargin),
  }
}
