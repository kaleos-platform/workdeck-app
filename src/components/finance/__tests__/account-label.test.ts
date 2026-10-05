/** @jest-environment node */
import { accountLabel } from '../format'

describe('accountLabel — 동명 계좌 구분', () => {
  test('계좌번호 끝 4자리(숫자만) 병기', () => {
    expect(accountLabel({ kind: 'BANK', name: '우리은행', accountNumber: '1002-345-678901' })).toBe(
      '은행 · 우리은행 ··8901'
    )
  })
  test('번호 없음·4자리 미만이면 이름만', () => {
    expect(accountLabel({ kind: 'CARD', name: '하나카드', accountNumber: null })).toBe(
      '카드 · 하나카드'
    )
    expect(accountLabel({ kind: 'BANK', name: '기업', accountNumber: '***12' })).toBe('은행 · 기업')
  })
})
