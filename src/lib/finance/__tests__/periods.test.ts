/**
 * periods 순수 함수 유닛 — 직전월 기준(현재월 제외)·grain별 목록·정규화.
 */
import {
  bucketOf,
  bucketLabel,
  availablePeriods,
  defaultSelectedPeriods,
  normalizeSelectedPeriods,
  bucketMonthRange,
  MAX_PERIODS,
} from '@/lib/finance/periods'

const NOW = '2026-07' // 7월 진행 중 → 기준은 직전월 6월

describe('bucketOf', () => {
  test('grain별 버킷 키', () => {
    expect(bucketOf('2026-06', 'month')).toBe('2026-06')
    expect(bucketOf('2026-06', 'quarter')).toBe('2026-Q2')
    expect(bucketOf('2026-01', 'quarter')).toBe('2026-Q1')
    expect(bucketOf('2026-12', 'quarter')).toBe('2026-Q4')
    expect(bucketOf('2026-06', 'year')).toBe('2026')
  })
})

describe('availablePeriods (최신순, 현재월 제외)', () => {
  test('월: 직전월(6월)이 최신, 현재월(7월) 미포함, 24개', () => {
    const p = availablePeriods('month', NOW)
    expect(p[0]).toBe('2026-06')
    expect(p).not.toContain('2026-07')
    expect(p.length).toBe(24)
    // 최신순
    expect(p[1]).toBe('2026-05')
  })
  test('분기: 직전월이 속한 분기(Q2)가 최신', () => {
    const p = availablePeriods('quarter', NOW)
    expect(p[0]).toBe('2026-Q2')
    expect(p).not.toContain('2026-Q3')
  })
  test('연: 직전월 연도(2026)가 최신', () => {
    const p = availablePeriods('year', NOW)
    expect(p[0]).toBe('2026')
  })
})

describe('defaultSelectedPeriods (직전월까지 최근 N, 오름차순)', () => {
  test('월 6개: 1~6월', () => {
    expect(defaultSelectedPeriods('month', NOW)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ])
  })
  test('분기 4개: 2025Q3~2026Q2', () => {
    expect(defaultSelectedPeriods('quarter', NOW)).toEqual([
      '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2',
    ])
  })
  test('연 3개: 2024~2026', () => {
    expect(defaultSelectedPeriods('year', NOW)).toEqual(['2024', '2025', '2026'])
  })
})

describe('normalizeSelectedPeriods', () => {
  test('형식검증+중복제거+정렬+MAX 캡', () => {
    const raw = ['2026-06', '2026-01', '2026-06', 'bad', '2026-03']
    expect(normalizeSelectedPeriods(raw, 'month')).toEqual(['2026-01', '2026-03', '2026-06'])
  })
  test('MAX(월 12) 초과 시 캡', () => {
    const raw = Array.from({ length: 15 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`)
      .filter((b) => /^\d{4}-(0[1-9]|1[0-2])$/.test(b))
    // 12개월만 유효 → 캡도 12
    expect(normalizeSelectedPeriods(raw, 'month')!.length).toBeLessThanOrEqual(MAX_PERIODS.month)
  })
  test('유효 없으면 null', () => {
    expect(normalizeSelectedPeriods(['bad', ''], 'month')).toBeNull()
  })
})

describe('bucketLabel', () => {
  test('grain별 한국어 라벨', () => {
    expect(bucketLabel('2026-05', 'month')).toBe('2026년 5월')
    expect(bucketLabel('2026-12', 'month')).toBe('2026년 12월')
    expect(bucketLabel('2026-Q1', 'quarter')).toBe('2026년 1분기')
    expect(bucketLabel('2025', 'year')).toBe('2025년')
  })
})

describe('bucketMonthRange', () => {
  test('월/분기/연 월범위', () => {
    expect(bucketMonthRange('2026-06', 'month')).toEqual({ firstYm: '2026-06', lastYm: '2026-06' })
    expect(bucketMonthRange('2026-Q2', 'quarter')).toEqual({ firstYm: '2026-04', lastYm: '2026-06' })
    expect(bucketMonthRange('2026', 'year')).toEqual({ firstYm: '2026-01', lastYm: '2026-12' })
  })
})
