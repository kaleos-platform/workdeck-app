/**
 * pnl-statement 순수 함수 유닛 — 관점별 순서·미지정 흡수·환불 불변식·헤더=Σleaf.
 */
import {
  buildPnlStatement,
  buildPnlSummary,
  safetyStatusOf,
  type PnlLeaf,
  type StatementRow,
} from '@/lib/finance/pnl-statement'
import type { FinFlowRole } from '@/generated/prisma/enums'

const B = ['2026-06']

function leaf(
  id: string,
  type: 'INCOME' | 'EXPENSE',
  flowRole: FinFlowRole | null,
  groupLabel: string | null,
  v: number
): PnlLeaf {
  return { id, name: id, type, flowRole, groupLabel, values: { '2026-06': v } }
}

// 매출액 700(상품600+배송100) · 매출원가 300(변동) · 판관비 170(변동50+고정120)
// 금융 40 · 미지정지출 20 · 기타수입 35(이자30+잡5)
const LEAVES: PnlLeaf[] = [
  leaf('상품매출', 'INCOME', 'MERCH_SALES', null, 600),
  leaf('배송비수익', 'INCOME', 'MERCH_SALES', null, 100),
  leaf('이자수익', 'INCOME', null, null, 30),
  leaf('잡이익', 'INCOME', null, null, 5),
  leaf('상품매입', 'EXPENSE', 'COGS', '변동', 300),
  leaf('지급수수료', 'EXPENSE', 'OPEX', '변동', 50),
  leaf('임차료', 'EXPENSE', 'OPEX', '고정', 80),
  leaf('급여', 'EXPENSE', 'OPEX', '고정', 40),
  leaf('지급이자', 'EXPENSE', 'FINANCING_COST', null, 40),
  leaf('기부금', 'EXPENSE', null, null, 20),
]

const val = (rows: StatementRow[], label: string): number | undefined =>
  rows.find((r) => r.label === label || r.label.startsWith(`${label} `))?.values['2026-06']

describe('buildPnlStatement', () => {
  it('손익계산서: 순서·소계·이익률', () => {
    const rows = buildPnlStatement(LEAVES, B, 'income-statement', 'hierarchy')
    const labels = rows.map((r) => r.label)
    expect(labels[0]).toBe('매출액')
    expect(val(rows, '매출액')).toBe(700)
    expect(val(rows, '매출총이익')).toBe(400)
    expect(rows.find((r) => r.label === '매출총이익')?.marginLabel).toBe('매출총이익률 57%')
    expect(val(rows, '판매비와관리비')).toBe(170)
    expect(val(rows, '영업이익')).toBe(230)
    expect(val(rows, '당기순이익')).toBe(205)
  })

  it('공헌이익: 변동/고정 분해, 영업이익 동일', () => {
    const inc = buildPnlStatement(LEAVES, B, 'income-statement', 'hierarchy')
    const con = buildPnlStatement(LEAVES, B, 'contribution', 'hierarchy')
    expect(val(con, '변동비')).toBe(350) // 300+50
    expect(val(con, '공헌이익')).toBe(350) // 700-350
    expect(val(con, '고정비')).toBe(120) // 임차료80+급여40
    // 불변식: 영업이익·당기순이익 양 관점 동일
    expect(val(con, '영업이익')).toBe(val(inc, '영업이익'))
    expect(val(con, '당기순이익')).toBe(val(inc, '당기순이익'))
  })

  it('미지정·금융 → 영업외비용 흡수, 당기순이익 = Σ수입 − Σ지출', () => {
    const rows = buildPnlStatement(LEAVES, B, 'income-statement', 'hierarchy')
    expect(val(rows, '영업외수익')).toBe(35) // 이자30+잡5
    expect(val(rows, '영업외비용')).toBe(60) // 금융40 + 미지정20
    const sumIn = 700 + 35
    const sumOut = 300 + 50 + 80 + 40 + 40 + 20
    expect(val(rows, '당기순이익')).toBe(sumIn - sumOut) // 205 = 순현금흐름
  })

  it('환불 불변식: 자연부호 net 음수여도 정합 유지', () => {
    // 상품매출 대량 환불로 매출 계정 net 음수, COGS 환불로 원가 net 음수.
    const refunded: PnlLeaf[] = [
      leaf('상품매출', 'INCOME', 'MERCH_SALES', null, -50), // 환불 초과
      leaf('상품매입', 'EXPENSE', 'COGS', '변동', -30), // 반품 환입
      leaf('임차료', 'EXPENSE', 'OPEX', '고정', 80),
      leaf('이자수익', 'INCOME', null, null, 10),
    ]
    const inc = buildPnlStatement(refunded, B, 'income-statement', 'hierarchy')
    const con = buildPnlStatement(refunded, B, 'contribution', 'hierarchy')
    // 영업이익 동일 = 매출(-50) − 원가(-30) − 판관비(80) = -100
    expect(val(inc, '영업이익')).toBe(-100)
    expect(con && val(con, '영업이익')).toBe(-100)
    // 당기순이익 = Σ수입(-50+10) − Σ지출(-30+80) = -40 − 50 = -90
    expect(val(inc, '당기순이익')).toBe(-90)
  })

  it('헤더 = Σleaf (다중 leaf 그룹)', () => {
    const rows = buildPnlStatement(LEAVES, B, 'income-statement', 'hierarchy')
    const header = rows.find((r) => r.label === '매출액')!.values['2026-06']
    const leaves = rows
      .filter((r) => r.variant === 'leaf' && ['상품매출', '배송비수익'].includes(r.label))
      .reduce((s, r) => s + r.values['2026-06'], 0)
    expect(header).toBe(leaves) // 700
  })

  it('대분류 모드: 하위 leaf 생략', () => {
    const rows = buildPnlStatement(LEAVES, B, 'income-statement', 'group')
    expect(rows.some((r) => r.variant === 'leaf')).toBe(false)
    expect(val(rows, '매출액')).toBe(700)
  })

  it('단일 leaf 그룹: 리프명(그룹명) 병합', () => {
    const rows = buildPnlStatement(LEAVES, B, 'income-statement', 'hierarchy')
    // 매출원가 = 상품매입 단일 → "상품매입 (매출원가)"
    expect(rows.some((r) => r.label === '상품매입 (매출원가)')).toBe(true)
  })

  it('요약: 이익률·순이익율·안전한계율', () => {
    const s = buildPnlSummary(LEAVES, B)
    expect(s.revenue).toBe(700)
    expect(s.grossProfit).toBe(400)
    expect(s.grossMarginRatio).toBe(57) // 400/700
    expect(s.contributionMarginRatio).toBe(50) // 350/700
    expect(s.operatingIncome).toBe(230)
    expect(s.operatingMarginRatio).toBe(33) // 230/700
    expect(s.netIncome).toBe(205)
    expect(s.netMarginRatio).toBe(29) // 205/700
    // 안전한계율 = 영업이익/공헌이익 = 230/350 = 65.71 → 우수
    expect(s.safetyMargin).toBeCloseTo(65.71, 1)
    expect(s.safetyStatus).toBe('우수')
  })

  it('안전한계율 구간 경계: 30/20/10', () => {
    expect(safetyStatusOf(30)).toBe('우수')
    expect(safetyStatusOf(29.9)).toBe('양호')
    expect(safetyStatusOf(20)).toBe('양호')
    expect(safetyStatusOf(19.9)).toBe('보통')
    expect(safetyStatusOf(10)).toBe('보통')
    expect(safetyStatusOf(9.9)).toBe('위험')
    expect(safetyStatusOf(-5)).toBe('위험') // 영업손실
    expect(safetyStatusOf(null)).toBeNull()
  })

  it('공헌이익 ≤ 0: 안전한계율 null', () => {
    const loss: PnlLeaf[] = [
      leaf('상품매출', 'INCOME', 'MERCH_SALES', null, 100),
      leaf('상품매입', 'EXPENSE', 'COGS', '변동', 150), // 변동비 > 매출
    ]
    const s = buildPnlSummary(loss, B)
    expect(s.contributionMargin).toBeLessThanOrEqual(0)
    expect(s.safetyMargin).toBeNull()
    expect(s.safetyStatus).toBeNull()
  })

  it('선택 가능: 그룹/리프는 categoryIds·direction 보유, 소계는 미선택', () => {
    const rows = buildPnlStatement(LEAVES, B, 'income-statement', 'hierarchy')
    const 매출액 = rows.find((r) => r.label === '매출액')!
    expect(매출액.selectable).toBe(true)
    expect(매출액.direction).toBe('IN')
    expect(매출액.categoryIds).toEqual(['상품매출', '배송비수익'])
    const 판관비leaf = rows.find((r) => r.variant === 'leaf' && r.label === '임차료')!
    expect(판관비leaf.selectable).toBe(true)
    expect(판관비leaf.direction).toBe('OUT')
    expect(판관비leaf.categoryIds).toEqual(['임차료'])
    const 소계 = rows.find((r) => r.label === '매출총이익')!
    expect(소계.selectable).toBeFalsy()
  })
})
