/** @jest-environment node */
import { classifyRow, type ClassRuleLite } from '../classify'
import type { FinTxnDirection } from '@/generated/prisma/enums'

// matchKey는 저장 시 정규화된 형태(소문자·공백정리)로 가정. direction 기본 null(방향 무관).
const rule = (
  id: string,
  matchKey: string,
  matchType: 'EXACT' | 'KEYWORD',
  categoryId: string,
  direction: FinTxnDirection | null = null,
  memo: string | null = null
): ClassRuleLite => ({
  id,
  matchKey,
  matchType,
  categoryId,
  direction,
  memo,
})

describe('classifyRow — 결정적 규칙 매칭', () => {
  test('EXACT 전체 일치 → CLASSIFIED', () => {
    const rules = [rule('r1', '스마트스토어 정산', 'EXACT', 'cat-sales')]
    const res = classifyRow({ description: '스마트스토어 정산' }, rules, 'IN')
    expect(res).toEqual({
      categoryId: 'cat-sales',
      classStatus: 'CLASSIFIED',
      matchedRuleId: 'r1',
      ruleMemo: null,
    })
  })

  test('매칭 규칙의 memo가 ruleMemo로 반환된다 (EXACT)', () => {
    const rules = [rule('r1', '스마트스토어 정산', 'EXACT', 'cat-sales', 'IN', '정산 메모')]
    const res = classifyRow({ description: '스마트스토어 정산' }, rules, 'IN')
    expect(res.ruleMemo).toBe('정산 메모')
  })

  test('KEYWORD 부분 포함 → REVIEW', () => {
    const rules = [rule('r2', '택배', 'KEYWORD', 'cat-delivery')]
    const res = classifyRow({ description: 'CJ대한통운 택배비' }, rules, 'OUT')
    expect(res.categoryId).toBe('cat-delivery')
    expect(res.classStatus).toBe('REVIEW')
    expect(res.matchedRuleId).toBe('r2')
  })

  test('EXACT가 KEYWORD보다 우선', () => {
    const rules = [
      rule('kw', '쿠팡', 'KEYWORD', 'cat-keyword'),
      rule('ex', '쿠팡 정산입금', 'EXACT', 'cat-exact'),
    ]
    const res = classifyRow({ description: '쿠팡 정산입금' }, rules, 'IN')
    expect(res.categoryId).toBe('cat-exact')
    expect(res.classStatus).toBe('CLASSIFIED')
  })

  test('KEYWORD 다중 매칭 시 가장 긴(구체적) 키워드', () => {
    const rules = [
      rule('short', '카드', 'KEYWORD', 'cat-short'),
      rule('long', '신한카드', 'KEYWORD', 'cat-long'),
    ]
    const res = classifyRow({ description: '신한카드 결제' }, rules, 'OUT')
    expect(res.categoryId).toBe('cat-long')
  })

  test('적요+상대 결합 매칭', () => {
    const rules = [rule('r', '홍길동', 'KEYWORD', 'cat-payroll')]
    const res = classifyRow({ description: '급여이체', counterparty: '홍길동' }, rules, 'OUT')
    expect(res.categoryId).toBe('cat-payroll')
  })

  test('무매칭 → UNCLASSIFIED', () => {
    const rules = [rule('r', '존재하지않는키', 'EXACT', 'cat-x')]
    const res = classifyRow({ description: '알수없는거래' }, rules, 'IN')
    expect(res).toEqual({
      categoryId: null,
      classStatus: 'UNCLASSIFIED',
      matchedRuleId: null,
      ruleMemo: null,
    })
  })

  test('빈 적요 → UNCLASSIFIED', () => {
    const res = classifyRow(
      { description: '', counterparty: null },
      [rule('r', '아무거나', 'KEYWORD', 'c')],
      'IN'
    )
    expect(res.classStatus).toBe('UNCLASSIFIED')
  })

  test('대소문자/공백 무시(정규화)', () => {
    const rules = [rule('r', 'naver pay', 'KEYWORD', 'cat-naver')]
    const res = classifyRow({ description: 'NAVER   Pay 정산' }, rules, 'IN')
    expect(res.categoryId).toBe('cat-naver')
  })

  // ─── 방향별 규칙 (req#4) ───────────────────────────────────────────────────

  test('같은 적요라도 방향별로 다른 계정과목 분류', () => {
    const rules = [
      rule('in', '쿠팡', 'EXACT', 'cat-income', 'IN'),
      rule('out', '쿠팡', 'EXACT', 'cat-expense', 'OUT'),
    ]
    expect(classifyRow({ description: '쿠팡' }, rules, 'IN').categoryId).toBe('cat-income')
    expect(classifyRow({ description: '쿠팡' }, rules, 'OUT').categoryId).toBe('cat-expense')
  })

  test('방향-특정 규칙이 방향무관(null) 규칙보다 우선', () => {
    const rules = [
      rule('any', '쿠팡', 'EXACT', 'cat-any', null),
      rule('out', '쿠팡', 'EXACT', 'cat-out', 'OUT'),
    ]
    // OUT 행 → 방향-특정(out) 우선
    expect(classifyRow({ description: '쿠팡' }, rules, 'OUT').categoryId).toBe('cat-out')
    // IN 행 → OUT 전용은 매칭 안 됨, null로 폴백
    expect(classifyRow({ description: '쿠팡' }, rules, 'IN').categoryId).toBe('cat-any')
  })

  test('반대 방향 전용 규칙은 매칭하지 않음', () => {
    const rules = [rule('out', '쿠팡', 'EXACT', 'cat-out', 'OUT')]
    expect(classifyRow({ description: '쿠팡' }, rules, 'IN').classStatus).toBe('UNCLASSIFIED')
  })
})
