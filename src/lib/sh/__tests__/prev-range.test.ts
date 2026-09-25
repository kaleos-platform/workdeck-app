import { prevRange, lastClosedDateKst } from '@/lib/sh/sales-analytics'

describe('prevRange', () => {
  it('완결된 달력 월 → 직전 달 전체', () => {
    expect(prevRange({ from: '2026-08-01', to: '2026-08-31' })).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('말일 clamp — 3월 전체 → 2월 전체', () => {
    expect(prevRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('완결된 12개월 → 직전 12개월 전체', () => {
    expect(prevRange({ from: '2026-01-01', to: '2026-12-31' })).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    })
  })

  it('진행중인 달(마지막 집계일 종료) → 전월 동일 일자까지', () => {
    const to = lastClosedDateKst()
    const from = `${to.slice(0, 7)}-01`
    const prev = prevRange({ from, to })
    const [y, m] = from.split('-').map(Number)
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    expect(prev.from).toBe(`${prevMonth}-01`)
    expect(prev.to.slice(0, 7)).toBe(prevMonth)
    // 일자가 보존된다 (말일 clamp 가능)
    expect(Number(prev.to.slice(8))).toBeLessThanOrEqual(Number(to.slice(8)))
  })

  it('달력 주(월~일) → 직전 주', () => {
    // 2026-09-07(월) ~ 2026-09-13(일)
    expect(prevRange({ from: '2026-09-07', to: '2026-09-13' })).toEqual({
      from: '2026-08-31',
      to: '2026-09-06',
    })
  })

  it('임의 구간 → 직전 동일 길이', () => {
    // 14일 구간
    expect(prevRange({ from: '2026-03-05', to: '2026-03-18' })).toEqual({
      from: '2026-02-19',
      to: '2026-03-04',
    })
  })

  it('최근 30일(월 경계 미정렬) → 직전 30일', () => {
    expect(prevRange({ from: '2026-08-23', to: '2026-09-21' })).toEqual({
      from: '2026-07-24',
      to: '2026-08-22',
    })
  })

  it('단일일 → 전날 (특례 없이 길이 규칙에서 떨어진다)', () => {
    expect(prevRange({ from: '2026-09-10', to: '2026-09-10' })).toEqual({
      from: '2026-09-09',
      to: '2026-09-09',
    })
  })

  it('월 시작이지만 월 경계로 끝나지 않으면 길이 시프트', () => {
    // 2026-09-01 ~ 2026-09-10 (말일도 집계일도 아님)
    expect(prevRange({ from: '2026-09-01', to: '2026-09-10' })).toEqual({
      from: '2026-08-22',
      to: '2026-08-31',
    })
  })
})
