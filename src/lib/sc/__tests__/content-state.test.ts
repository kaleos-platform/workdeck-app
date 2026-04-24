import { canTransition, nextAllowed, countDocTextLength } from '../content-state'

describe('content-state canTransition', () => {
  it('DRAFT → IN_REVIEW 허용', () => {
    expect(canTransition('DRAFT', 'IN_REVIEW')).toBe(true)
  })

  it('IN_REVIEW → APPROVED 허용, DRAFT 복귀 허용', () => {
    expect(canTransition('IN_REVIEW', 'APPROVED')).toBe(true)
    expect(canTransition('IN_REVIEW', 'DRAFT')).toBe(true)
  })

  it('APPROVED → SCHEDULED/PUBLISHED/DRAFT 허용', () => {
    expect(canTransition('APPROVED', 'SCHEDULED')).toBe(true)
    expect(canTransition('APPROVED', 'PUBLISHED')).toBe(true)
    expect(canTransition('APPROVED', 'DRAFT')).toBe(true)
  })

  it('PUBLISHED → ANALYZED 허용, 반대 금지', () => {
    expect(canTransition('PUBLISHED', 'ANALYZED')).toBe(true)
    expect(canTransition('ANALYZED', 'PUBLISHED')).toBe(false)
  })

  it('DRAFT → PUBLISHED 같은 스킵 전이 금지', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false)
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false)
  })

  it('같은 상태 전이 금지', () => {
    expect(canTransition('DRAFT', 'DRAFT')).toBe(false)
  })
})

describe('nextAllowed', () => {
  it('ANALYZED 는 빈 배열', () => {
    expect(nextAllowed('ANALYZED')).toEqual([])
  })
  it('DRAFT 는 IN_REVIEW 만', () => {
    expect(nextAllowed('DRAFT')).toEqual(['IN_REVIEW'])
  })
})

describe('countDocTextLength', () => {
  it('빈 doc 은 0', () => {
    expect(countDocTextLength({ type: 'doc', content: [] })).toBe(0)
  })
  it('중첩 paragraph 의 text 길이 누적', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '안녕' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world' }] },
      ],
    }
    expect(countDocTextLength(doc)).toBe(2 + 5)
  })
  it('잘못된 입력은 0', () => {
    expect(countDocTextLength(null)).toBe(0)
    expect(countDocTextLength('string')).toBe(0)
  })
})
