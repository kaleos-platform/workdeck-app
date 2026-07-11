// metrics-dedup 은 Prisma 비의존 순수 함수 모듈 → 표준 jest config 로 실행 가능.
import { pickDailyMetrics } from '../metrics-dedup'
import type { MetricRow } from '../metrics-dedup'

// MetricRow 픽스처 헬퍼 — 테스트에 필요한 필드만 채운다.
function makeRow(
  overrides: Partial<MetricRow> & Pick<MetricRow, 'date' | 'source'>
): MetricRow {
  return {
    impressions: null,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    externalClicks: null,
    ...overrides,
  }
}

const DATE_A = new Date('2024-01-10T00:00:00Z')
const DATE_B = new Date('2024-01-11T00:00:00Z')

describe('pickDailyMetrics', () => {
  it('단일 source 만 있을 때 그대로 반환한다', () => {
    const rows = [
      makeRow({ date: DATE_A, source: 'BROWSER', views: 10 }),
      makeRow({ date: DATE_B, source: 'BROWSER', views: 20 }),
    ]
    const result = pickDailyMetrics(rows)
    expect(result).toHaveLength(2)
    const viewsSum = result.reduce((s, r) => s + (r.views ?? 0), 0)
    expect(viewsSum).toBe(30)
  })

  it('같은 날짜 MANUAL + BROWSER 공존 시 MANUAL 만 채택한다 (이중합산 없음)', () => {
    const rows = [
      makeRow({ date: DATE_A, source: 'MANUAL', views: 100 }),
      makeRow({ date: DATE_A, source: 'BROWSER', views: 80 }),
    ]
    const result = pickDailyMetrics(rows)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('MANUAL')
    expect(result[0].views).toBe(100)
  })

  it('같은 날짜 BROWSER + API 공존 시 BROWSER 채택', () => {
    const rows = [
      makeRow({ date: DATE_A, source: 'API', views: 50 }),
      makeRow({ date: DATE_A, source: 'BROWSER', views: 70 }),
    ]
    const result = pickDailyMetrics(rows)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('BROWSER')
  })

  it('같은 날짜 API + INTERNAL 공존 시 API 채택', () => {
    const rows = [
      makeRow({ date: DATE_A, source: 'INTERNAL', views: 5 }),
      makeRow({ date: DATE_A, source: 'API', views: 15 }),
    ]
    const result = pickDailyMetrics(rows)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('API')
  })

  it('MANUAL > BROWSER > API > INTERNAL 전체 우선순위 검증', () => {
    const rows = [
      makeRow({ date: DATE_A, source: 'INTERNAL', views: 1 }),
      makeRow({ date: DATE_A, source: 'API', views: 2 }),
      makeRow({ date: DATE_A, source: 'BROWSER', views: 3 }),
      makeRow({ date: DATE_A, source: 'MANUAL', views: 4 }),
    ]
    const result = pickDailyMetrics(rows)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('MANUAL')
    expect(result[0].views).toBe(4)
  })

  it('서로 다른 날짜는 각각 최우선 source 를 독립적으로 채택한다', () => {
    const rows = [
      makeRow({ date: DATE_A, source: 'MANUAL', views: 100 }),
      makeRow({ date: DATE_A, source: 'BROWSER', views: 80 }),
      makeRow({ date: DATE_B, source: 'API', views: 30 }),
      makeRow({ date: DATE_B, source: 'BROWSER', views: 50 }),
    ]
    const result = pickDailyMetrics(rows)
    expect(result).toHaveLength(2)

    const byDate = Object.fromEntries(
      result.map((r) => [r.date.toISOString().slice(0, 10), r])
    )
    expect(byDate['2024-01-10'].source).toBe('MANUAL')
    expect(byDate['2024-01-10'].views).toBe(100)
    expect(byDate['2024-01-11'].source).toBe('BROWSER')
    expect(byDate['2024-01-11'].views).toBe(50)
  })

  it('행이 없으면 빈 배열을 반환한다', () => {
    expect(pickDailyMetrics([])).toEqual([])
  })
})
