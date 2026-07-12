/** @jest-environment node */
/**
 * 룰(키워드) 추천 순수 로직 단위 테스트 (ruleSuggestionFor).
 * - 시드 키워드 매칭 → "'<kw>' 키워드 일치" reason
 * - 학습 규칙(EXACT) 매칭 → "학습된 규칙과 일치" reason
 * - 매칭 없음 → null
 */
import { ruleSuggestionFor } from '@/lib/finance/rule-suggest'
import type { ClassRuleLite } from '@/lib/finance/classify'

const nameById = new Map([
  ['c1', '택배비'],
  ['c2', '광고비'],
])

const ruleset: ClassRuleLite[] = [
  {
    id: 'seed:택배',
    matchKey: '택배',
    matchType: 'KEYWORD',
    categoryId: 'c1',
    direction: 'OUT',
    memo: null,
  },
  {
    id: 'seed:광고',
    matchKey: '광고',
    matchType: 'KEYWORD',
    categoryId: 'c2',
    direction: 'OUT',
    memo: null,
  },
  {
    id: 'rule-learned',
    matchKey: 'cj대한통운 택배',
    matchType: 'EXACT',
    categoryId: 'c1',
    direction: 'OUT',
    memo: null,
  },
]

test('시드 키워드 매칭 → 키워드 reason', () => {
  const r = ruleSuggestionFor(
    { description: '택배 발송비', counterparty: null },
    'OUT',
    ruleset,
    nameById
  )
  expect(r).toEqual({ categoryId: 'c1', categoryName: '택배비', reason: "'택배' 키워드 일치" })
})

test('학습 규칙(EXACT 전체 일치) 매칭 → 학습 reason', () => {
  const r = ruleSuggestionFor(
    { description: 'CJ대한통운 택배', counterparty: null },
    'OUT',
    ruleset,
    nameById
  )
  expect(r?.categoryId).toBe('c1')
  expect(r?.reason).toBe('학습된 규칙과 일치')
})

test('키워드 미포함 → null', () => {
  expect(
    ruleSuggestionFor({ description: '무관한 적요', counterparty: null }, 'OUT', ruleset, nameById)
  ).toBeNull()
})

test('방향 불일치(OUT 규칙에 IN 거래) → null', () => {
  expect(
    ruleSuggestionFor({ description: '택배 발송비', counterparty: null }, 'IN', ruleset, nameById)
  ).toBeNull()
})
