/**
 * 현금흐름 기간(버킷) 유틸 — 순수 함수(브라우저·서버 공용, 유닛 테스트 대상).
 * grain(월/분기/연) 버킷 키 계산 + 기간 선택 후보/기본값. 기준은 항상 "직전 월"(진행 중인
 * 현재월은 데이터가 불완전하므로 제외).
 */
import { addMonths } from '@/lib/finance/aggregate'

export type Grain = 'month' | 'quarter' | 'year'

/** ym("YYYY-MM") → 버킷 키(grain별). month=YYYY-MM, quarter=YYYY-Qn, year=YYYY. */
export function bucketOf(ym: string, grain: Grain): string {
  const [y, m] = ym.split('-').map(Number)
  if (grain === 'year') return `${y}`
  if (grain === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
  return ym
}

/** 테이블 컬럼(선택 기간) 최대 개수 — 초과 시 가독성·가로 스크롤 부담. */
export const MAX_PERIODS: Record<Grain, number> = { month: 12, quarter: 8, year: 10 }

/** 기본 표시 기간 개수(직전월까지 최근 N). */
export const DEFAULT_COUNT: Record<Grain, number> = { month: 6, quarter: 4, year: 3 }

/** 피커 선택 후보 목록 윈도우(얼마나 과거까지 고를 수 있나). */
const WINDOW: Record<Grain, number> = { month: 24, quarter: 16, year: 10 }

/** grain별 버킷 키 형식 검증. */
export function isValidBucket(bucket: string, grain: Grain): boolean {
  if (grain === 'year') return /^\d{4}$/.test(bucket)
  if (grain === 'quarter') return /^\d{4}-Q[1-4]$/.test(bucket)
  return /^\d{4}-\d{2}$/.test(bucket)
}

/** 직전월 기준으로 최신→과거 방향으로 distinct 버킷 count개 생성(최신 우선). */
function generatePeriods(grain: Grain, nowYm: string, count: number): string[] {
  let cursor = addMonths(nowYm, -1) // 직전월 기준(현재월 제외)
  const out: string[] = []
  // count*12는 연 grain에서도 충분한 상한(무한 루프 방지).
  for (let guard = 0; out.length < count && guard < count * 12 + 24; guard++) {
    const b = bucketOf(cursor, grain)
    if (!out.includes(b)) out.push(b)
    cursor = addMonths(cursor, -1)
  }
  return out
}

/** 피커 후보(최신순). */
export function availablePeriods(grain: Grain, nowYm: string): string[] {
  return generatePeriods(grain, nowYm, WINDOW[grain])
}

/** 기본 선택 기간(직전월까지 최근 DEFAULT_COUNT개, 오름차순). */
export function defaultSelectedPeriods(grain: Grain, nowYm: string): string[] {
  return generatePeriods(grain, nowYm, DEFAULT_COUNT[grain]).reverse()
}

/** 버킷이 포함하는 월 범위(YYYY-MM). API 조회 범위 계산용. */
export function bucketMonthRange(bucket: string, grain: Grain): { firstYm: string; lastYm: string } {
  if (grain === 'year') {
    return { firstYm: `${bucket}-01`, lastYm: `${bucket}-12` }
  }
  if (grain === 'quarter') {
    const [y, q] = bucket.split('-Q').map(Number)
    const firstMonth = (q - 1) * 3 + 1
    return {
      firstYm: `${y}-${String(firstMonth).padStart(2, '0')}`,
      lastYm: `${y}-${String(firstMonth + 2).padStart(2, '0')}`,
    }
  }
  return { firstYm: bucket, lastYm: bucket }
}

/**
 * 선택 버킷 목록을 정규화: 형식 검증 + 중복 제거 + 오름차순 정렬 + MAX 캡.
 * 유효 항목이 없으면 null(호출측이 기본값 사용).
 */
export function normalizeSelectedPeriods(raw: string[], grain: Grain): string[] | null {
  const valid = [...new Set(raw.map((s) => s.trim()).filter((s) => isValidBucket(s, grain)))]
  if (valid.length === 0) return null
  valid.sort() // 버킷키는 사전식 == 시간순(YYYY-MM, YYYY-Qn, YYYY)
  return valid.slice(0, MAX_PERIODS[grain])
}
