/**
 * cashflow-grouping 순수 함수 유닛 테스트 — 산술 불변식(브라우저 불필요).
 * 핵심: 각 모드의 그룹 합계 총합 == 섹션 total.
 */
import { buildCashflowGroups, type CashflowLeaf } from '@/lib/finance/cashflow-grouping'

const BUCKETS = ['2026-06', '2026-07']

function leaf(
  partial: Partial<CashflowLeaf> & {
    key: string
    type: 'INCOME' | 'EXPENSE'
    values: Record<string, number>
  }
): CashflowLeaf {
  return {
    name: partial.key,
    groupLabel: null,
    parentId: null,
    parentName: '미분류',
    flowRole: null,
    changePct: null,
    ...partial,
  }
}

// 수입 리프: 매출(P1: A,B), 기타(P2: C), 미분류
const INCOME: CashflowLeaf[] = [
  leaf({
    key: 'A',
    type: 'INCOME',
    parentId: 'P1',
    parentName: '매출대분류',
    flowRole: 'MERCH_SALES',
    values: { '2026-06': 100, '2026-07': 200 },
  }),
  leaf({
    key: 'B',
    type: 'INCOME',
    parentId: 'P1',
    parentName: '매출대분류',
    flowRole: 'MERCH_SALES',
    values: { '2026-06': 50, '2026-07': 0 },
  }),
  leaf({
    key: 'C',
    type: 'INCOME',
    parentId: 'P2',
    parentName: '기타수입',
    flowRole: null,
    values: { '2026-06': 30, '2026-07': 10 },
  }),
  leaf({
    key: '미분류수입',
    type: 'INCOME',
    parentId: null,
    parentName: '미분류',
    flowRole: null,
    values: { '2026-06': 5, '2026-07': 0 },
  }),
]
// 지출 리프: 고정(D), 변동(E), 미지정(F)
const EXPENSE: CashflowLeaf[] = [
  leaf({
    key: 'D',
    type: 'EXPENSE',
    parentId: 'E1',
    parentName: '인건비',
    groupLabel: '고정',
    values: { '2026-06': 40, '2026-07': 20 },
  }),
  leaf({
    key: 'E',
    type: 'EXPENSE',
    parentId: 'E1',
    parentName: '인건비',
    groupLabel: '변동',
    values: { '2026-06': 10, '2026-07': 5 },
  }),
  leaf({
    key: 'F',
    type: 'EXPENSE',
    parentId: 'E2',
    parentName: '기타지출',
    groupLabel: null,
    values: { '2026-06': 7, '2026-07': 0 },
  }),
]

const sumGroups = (groups: { values: Record<string, number> }[], b: string) =>
  groups.reduce((a, g) => a + g.values[b], 0)

describe('buildCashflowGroups', () => {
  test('leaf 모드 수입: 매출 + 기타 == 섹션 합 (버킷별)', () => {
    const g = buildCashflowGroups(INCOME, BUCKETS, 'leaf')
    expect(g.map((x) => x.label)).toEqual(['매출', '기타']) // 고정 순서
    const merch = g.find((x) => x.label === '매출')!
    const other = g.find((x) => x.label === '기타')!
    expect(merch.values['2026-06']).toBe(150) // A+B
    expect(merch.values['2026-07']).toBe(200)
    expect(other.values['2026-06']).toBe(35) // C + 미분류
    expect(other.values['2026-07']).toBe(10)
    // 불변식: 매출+기타 == 총수입
    expect(sumGroups(g, '2026-06')).toBe(185)
    expect(sumGroups(g, '2026-07')).toBe(210)
  })

  test('leaf 모드 지출: 고정 + 변동 + 미지정 == 섹션 합', () => {
    const g = buildCashflowGroups(EXPENSE, BUCKETS, 'leaf')
    expect(g.map((x) => x.label)).toEqual(['고정', '변동', '미지정'])
    expect(sumGroups(g, '2026-06')).toBe(57) // 40+10+7
    expect(sumGroups(g, '2026-07')).toBe(25) // 20+5+0
    // 미지정 그룹에 F가 들어갔는지
    expect(g.find((x) => x.label === '미지정')!.leaves.map((l) => l.key)).toEqual(['F'])
  })

  test('group/hierarchy 모드: 대분류 그룹 합의 총합 == 섹션 합', () => {
    const g = buildCashflowGroups(INCOME, BUCKETS, 'group')
    // P1(매출) + P2(기타) + 미분류
    expect(sumGroups(g, '2026-06')).toBe(185)
    expect(sumGroups(g, '2026-07')).toBe(210)
    const p1 = g.find((x) => x.label === '매출대분류')!
    expect(p1.flowRole).toBe('MERCH_SALES')
    expect(p1.values['2026-06']).toBe(150)
    expect(p1.leaves.map((l) => l.key)).toEqual(['A', 'B']) // 합계 내림차순
    // 합계 내림차순 정렬(첫 그룹이 가장 큼)
    expect(g[0].label).toBe('매출대분류')
  })

  test('hierarchy 모드는 group과 동일 그룹 + leaves 유지', () => {
    const g = buildCashflowGroups(EXPENSE, BUCKETS, 'hierarchy')
    const e1 = g.find((x) => x.label === '인건비')!
    expect(e1.leaves.map((l) => l.key).sort()).toEqual(['D', 'E'])
    expect(e1.values['2026-06']).toBe(50) // 40+10
  })

  test('changePct: 마지막 vs 직전 버킷', () => {
    const g = buildCashflowGroups(INCOME, BUCKETS, 'leaf')
    const merch = g.find((x) => x.label === '매출')!
    // (200-150)/150*100 = 33.33
    expect(merch.changePct).toBeCloseTo(33.33, 1)
  })

  test('group 정렬: flowRole 우선순위(원가→영업→금융→기타), 동률 금액 desc', () => {
    const expense: CashflowLeaf[] = [
      leaf({
        key: 'fin',
        type: 'EXPENSE',
        parentId: 'PF',
        parentName: '금융비용',
        flowRole: 'FINANCING_COST',
        values: { '2026-06': 999, '2026-07': 0 },
      }),
      leaf({
        key: 'cogs',
        type: 'EXPENSE',
        parentId: 'PC',
        parentName: '매출원가',
        flowRole: 'COGS',
        values: { '2026-06': 10, '2026-07': 0 },
      }),
      leaf({
        key: 'op',
        type: 'EXPENSE',
        parentId: 'PO',
        parentName: '영업비용',
        flowRole: 'OPEX',
        values: { '2026-06': 20, '2026-07': 0 },
      }),
      leaf({
        key: 'etc',
        type: 'EXPENSE',
        parentId: 'PX',
        parentName: '미지정지출',
        flowRole: null,
        values: { '2026-06': 500, '2026-07': 0 },
      }),
    ]
    const g = buildCashflowGroups(expense, BUCKETS, 'group')
    // 금액은 금융>미지정>영업>원가지만, 우선순위로 원가→영업→금융→미지정
    expect(g.map((x) => x.label)).toEqual(['매출원가', '영업비용', '금융비용', '미지정지출'])
  })

  test('빈 입력 → 빈 배열', () => {
    expect(buildCashflowGroups([], BUCKETS, 'leaf')).toEqual([])
  })
})
