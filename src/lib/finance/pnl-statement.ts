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
  values: Record<string, number>
  changePct: number | null
  variant: 'group' | 'leaf' | 'subtotal'
}

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

/** 관점별 손익계산서 행 구성. */
export function buildPnlStatement(
  pnlLeaves: PnlLeaf[],
  buckets: string[],
  view: ProfitView,
  mode: StatementMode
): StatementRow[] {
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

  const rows: StatementRow[] = []

  // 그룹(헤더 + 하위 leaf). 단일 leaf 그룹은 "리프명(그룹명)"으로 병합. 빈 그룹은 생략.
  const pushGroup = (label: string, leaves: PnlLeaf[]) => {
    if (leaves.length === 0) return
    const values = sumLeaves(leaves, buckets)
    if (leaves.length === 1) {
      rows.push({
        key: `g:${label}`,
        label: `${leaves[0].name} (${label})`,
        values,
        changePct: changeOf(values, buckets),
        variant: 'group',
      })
      return
    }
    rows.push({
      key: `g:${label}`,
      label,
      values,
      changePct: changeOf(values, buckets),
      variant: 'group',
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
