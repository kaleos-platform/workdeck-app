import { closedPostingWhere, getPostingDisplayStatus, openPostingWhere } from '../posting-status'

// KST 2026-11-02 00:00 = 2026-11-01T15:00Z
const lastSecond = new Date('2026-11-02T14:59:59Z')
const midnight = new Date('2026-11-02T15:00:00Z')
const today = new Date('2026-11-02T00:00:00Z')

describe('getPostingDisplayStatus', () => {
  it('마감일이 오늘·내일·없음이면 발행 공고는 모집중', () => {
    expect(getPostingDisplayStatus('ACTIVE', today, lastSecond)).toBe('OPEN')
    expect(getPostingDisplayStatus('ACTIVE', new Date('2026-11-03T00:00:00Z'), lastSecond)).toBe(
      'OPEN'
    )
    expect(getPostingDisplayStatus('ACTIVE', null, lastSecond)).toBe('OPEN')
  })

  it('KST 자정이 지나면 오늘 마감 공고도 마감, 어제 마감일은 마감', () => {
    expect(getPostingDisplayStatus('ACTIVE', today, midnight)).toBe('CLOSED')
    expect(getPostingDisplayStatus('ACTIVE', new Date('2026-11-01T00:00:00Z'), lastSecond)).toBe(
      'CLOSED'
    )
  })

  it('문자열 마감일도 받고, 다른 저장 상태는 그대로 둔다', () => {
    expect(getPostingDisplayStatus('ACTIVE', '2026-11-01T00:00:00.000Z', lastSecond)).toBe('CLOSED')
    expect(getPostingDisplayStatus('CLOSED', null, lastSecond)).toBe('CLOSED')
    expect(getPostingDisplayStatus('DRAFT', '2020-01-01', lastSecond)).toBe('DRAFT')
    expect(getPostingDisplayStatus('ARCHIVED', '2020-01-01', lastSecond)).toBe('ARCHIVED')
  })
})

describe('where 헬퍼', () => {
  it('모집중은 KST 오늘 00:00Z 이후 또는 마감일 없음', () => {
    expect(openPostingWhere(lastSecond)).toEqual({
      status: 'ACTIVE',
      OR: [{ closingDate: null }, { closingDate: { gte: today } }],
    })
    expect(openPostingWhere(midnight).OR[1]).toEqual({
      closingDate: { gte: new Date('2026-11-03T00:00:00Z') },
    })
  })

  it('마감은 직접 마감 또는 발행인데 마감일이 오늘 이전', () => {
    expect(closedPostingWhere(lastSecond)).toEqual({
      OR: [{ status: 'CLOSED' }, { status: 'ACTIVE', closingDate: { lt: today } }],
    })
  })
})
