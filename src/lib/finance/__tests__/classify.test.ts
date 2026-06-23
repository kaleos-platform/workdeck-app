/** @jest-environment node */
import { classifyRow, type ClassRuleLite } from '../classify'

// matchKey는 저장 시 정규화된 형태(소문자·공백정리)로 가정
const rule = (
  id: string,
  matchKey: string,
  matchType: 'EXACT' | 'KEYWORD',
  categoryId: string
): ClassRuleLite => ({
  id,
  matchKey,
  matchType,
  categoryId,
})

describe('classifyRow — 결정적 규칙 매칭', () => {
  test('EXACT 전체 일치 → CLASSIFIED', () => {
    const rules = [rule('r1', '스마트스토어 정산', 'EXACT', 'cat-sales')]
    const res = classifyRow({ description: '스마트스토어 정산' }, rules)
    expect(res).toEqual({ categoryId: 'cat-sales', classStatus: 'CLASSIFIED', matchedRuleId: 'r1' })
  })

  test('KEYWORD 부분 포함 → REVIEW', () => {
    const rules = [rule('r2', '택배', 'KEYWORD', 'cat-delivery')]
    const res = classifyRow({ description: 'CJ대한통운 택배비' }, rules)
    expect(res.categoryId).toBe('cat-delivery')
    expect(res.classStatus).toBe('REVIEW')
    expect(res.matchedRuleId).toBe('r2')
  })

  test('EXACT가 KEYWORD보다 우선', () => {
    const rules = [
      rule('kw', '쿠팡', 'KEYWORD', 'cat-keyword'),
      rule('ex', '쿠팡 정산입금', 'EXACT', 'cat-exact'),
    ]
    const res = classifyRow({ description: '쿠팡 정산입금' }, rules)
    expect(res.categoryId).toBe('cat-exact')
    expect(res.classStatus).toBe('CLASSIFIED')
  })

  test('KEYWORD 다중 매칭 시 가장 긴(구체적) 키워드', () => {
    const rules = [
      rule('short', '카드', 'KEYWORD', 'cat-short'),
      rule('long', '신한카드', 'KEYWORD', 'cat-long'),
    ]
    const res = classifyRow({ description: '신한카드 결제' }, rules)
    expect(res.categoryId).toBe('cat-long')
  })

  test('적요+상대 결합 매칭', () => {
    const rules = [rule('r', '홍길동', 'KEYWORD', 'cat-payroll')]
    const res = classifyRow({ description: '급여이체', counterparty: '홍길동' }, rules)
    expect(res.categoryId).toBe('cat-payroll')
  })

  test('무매칭 → UNCLASSIFIED', () => {
    const rules = [rule('r', '존재하지않는키', 'EXACT', 'cat-x')]
    const res = classifyRow({ description: '알수없는거래' }, rules)
    expect(res).toEqual({ categoryId: null, classStatus: 'UNCLASSIFIED', matchedRuleId: null })
  })

  test('빈 적요 → UNCLASSIFIED', () => {
    const res = classifyRow({ description: '', counterparty: null }, [
      rule('r', '아무거나', 'KEYWORD', 'c'),
    ])
    expect(res.classStatus).toBe('UNCLASSIFIED')
  })

  test('대소문자/공백 무시(정규화)', () => {
    const rules = [rule('r', 'naver pay', 'KEYWORD', 'cat-naver')]
    const res = classifyRow({ description: 'NAVER   Pay 정산' }, rules)
    expect(res.categoryId).toBe('cat-naver')
  })
})
