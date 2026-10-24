import { addDays, advanceCursor, daysToSync } from '../schedule'

const range = (a: string, n: number) => Array.from({ length: n }, (_, i) => addDays(a, i))

describe('addDays', () => {
  it('월 경계', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
  })
})

describe('daysToSync', () => {
  const today = '2026-10-25'
  it('최초: 백필 7일 + 최근 7일', () => {
    const r = daysToSync(today, { startDate: '2026-10-01', backfilledThrough: null })
    expect(r).toEqual([...range('2026-10-01', 7), ...range('2026-10-18', 7)])
  })
  it('백필이 최근 구간에 닿았으면 최근 7일만', () => {
    expect(daysToSync(today, { startDate: '2026-10-01', backfilledThrough: '2026-10-17' })).toEqual(
      range('2026-10-18', 7)
    )
  })
  it('시작일이 최근 구간 안이면 시작일부터', () => {
    expect(daysToSync(today, { startDate: '2026-10-22', backfilledThrough: null })).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ])
  })
})

describe('advanceCursor', () => {
  const att = ['2026-10-01', '2026-10-02', '2026-10-03']
  it('연속 성공까지만 전진', () => {
    expect(
      advanceCursor('2026-09-30', '2026-10-01', att, new Set(['2026-10-01', '2026-10-03']))
    ).toBe('2026-10-01')
  })
  it('전부 실패면 prev 유지', () => {
    expect(advanceCursor('2026-09-30', '2026-10-01', att, new Set())).toBe('2026-09-30')
  })
  it('prev null + 첫날 성공', () => {
    expect(advanceCursor(null, '2026-10-01', att, new Set(['2026-10-01']))).toBe('2026-10-01')
  })
  it('매칭으로 커서가 null 로 초기화된 뒤 도착한 finish(최근 일자만)는 커서를 올리지 않는다', () => {
    const recent = ['2026-10-20', '2026-10-21']
    expect(advanceCursor(null, '2026-10-01', recent, new Set(recent))).toBeNull()
  })
})
