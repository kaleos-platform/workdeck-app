// 순수 함수 — Prisma/DB 의존 없음. 유닛 테스트 가능.
// metrics.ts 에서 re-export 하므로 외부 호출처는 경로를 바꿀 필요 없다.

import type { MetricSource } from '@/generated/prisma/client'

/** DeploymentMetric 행의 최소 형태 — pickDailyMetrics 에 필요한 필드만 정의 */
export interface MetricRow {
  date: Date
  source: MetricSource
  impressions: number | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  externalClicks: number | null
}

// source 우선순위: MANUAL > BROWSER > API > INTERNAL
// (MANUAL = 사용자 의도적 정정 → 최우선)
export const SOURCE_PRIORITY: Record<MetricSource, number> = {
  MANUAL: 3,
  BROWSER: 2,
  API: 1,
  INTERNAL: 0,
}

/**
 * 같은 날짜에 여러 source 행이 공존할 경우 단일 source 만 채택한다.
 * 우선순위: MANUAL > BROWSER > API > INTERNAL
 *
 * @param rows - MetricRow 배열 (단일 배포 기준)
 * @returns 날짜별 최우선 source 행만 포함한 배열
 */
export function pickDailyMetrics<T extends MetricRow>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10)
    const current = best.get(key)
    if (!current || SOURCE_PRIORITY[row.source] > SOURCE_PRIORITY[current.source]) {
      best.set(key, row)
    }
  }
  return [...best.values()]
}
