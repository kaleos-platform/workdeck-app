import { canExtendDeadline, getExtendDateBounds } from '../extend-posting'

// 2026-11-15 12:00 KST
const now = new Date('2026-11-15T03:00:00Z')

describe('getExtendDateBounds', () => {
  it('마감일이 미래면 최소값은 마감일 다음 날, 기본값은 +7일', () => {
    expect(getExtendDateBounds('2026-11-20T00:00:00.000Z', now)).toEqual({
      min: '2026-11-21',
      defaultDate: '2026-11-27',
    })
  })
  it('마감일이 지났으면 최소값은 오늘(KST), 기본값은 최소값 이상', () => {
    expect(getExtendDateBounds('2026-11-01', now)).toEqual({
      min: '2026-11-15',
      defaultDate: '2026-11-15',
    })
    expect(getExtendDateBounds('2026-11-10', now).defaultDate).toBe('2026-11-17')
  })
  it('KST 날짜가 UTC보다 앞서는 시각도 오늘을 KST로 본다', () => {
    expect(getExtendDateBounds('2026-11-01', new Date('2026-11-14T20:00:00Z')).min).toBe(
      '2026-11-15'
    )
  })
  it('월말을 넘겨 계산한다', () => {
    expect(getExtendDateBounds('2026-12-28', now).defaultDate).toBe('2027-01-04')
  })
})

it('발행 공고(접수 중·마감)이면서 마감일이 있을 때만 연장 가능', () => {
  expect(canExtendDeadline({ status: 'ACTIVE', closingDate: '2026-11-20' })).toBe(true)
  expect(canExtendDeadline({ status: 'CLOSED', closingDate: '2026-11-20' })).toBe(true)
  expect(canExtendDeadline({ status: 'ACTIVE', closingDate: null })).toBe(false)
  expect(canExtendDeadline({ status: 'DRAFT', closingDate: '2026-11-20' })).toBe(false)
})
