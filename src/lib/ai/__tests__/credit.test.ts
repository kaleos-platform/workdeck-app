import { currentYearMonth, CreditExceededError } from '../credit'

describe('currentYearMonth', () => {
  it('UTC 기준 YYYY-MM 을 반환한다', () => {
    expect(currentYearMonth(new Date('2026-04-24T10:00:00Z'))).toBe('2026-04')
    expect(currentYearMonth(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
    expect(currentYearMonth(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
  })

  it('한 자리 월을 0 으로 패딩한다', () => {
    expect(currentYearMonth(new Date('2026-03-15T00:00:00Z'))).toBe('2026-03')
    expect(currentYearMonth(new Date('2026-09-01T00:00:00Z'))).toBe('2026-09')
  })
})

describe('CreditExceededError', () => {
  it('code 상수와 yearMonth 를 가진다', () => {
    const err = new CreditExceededError('2026-04')
    expect(err.code).toBe('CREDIT_EXCEEDED')
    expect(err.yearMonth).toBe('2026-04')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('2026-04')
  })
})
