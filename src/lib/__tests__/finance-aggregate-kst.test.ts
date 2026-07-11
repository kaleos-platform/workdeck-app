// @jest-environment node
/**
 * aggregate.ts — ymOf / nowYmKst KST 경계 유닛 테스트.
 *
 * 핵심 불변식:
 *   1. ymOf(txnDate): txnDate는 "KST 벽시계 자릿수를 UTC로 저장"하므로 UTC getter로 읽으면 KST 월 복원.
 *      +9h 변환 없이도 정확해야 한다.
 *   2. nowYmKst(): 현재 시각의 KST 월. UTC 15:00(=KST 00:00 다음날) → 다음 날 월 버킷.
 */

import { ymOf, nowYmKst } from '@/lib/finance/aggregate'

describe('ymOf — KST 벽시계 저장 규약 기반 버킷팅', () => {
  test('UTC 자정(=KST 09:00) — 같은 날 월 버킷', () => {
    // 2026-01-31T00:00:00Z → KST 2026-01-31 09:00 → 월 = 2026-01
    expect(ymOf(new Date('2026-01-31T00:00:00Z'))).toBe('2026-01')
  })

  test('UTC 23:30(=KST 다음날 08:30) — KST 자릿수 저장이면 같은 날 버킷', () => {
    // commit-staging toDate: "2026-01-31 23:30:00" → new Date("2026-01-31T23:30:00") Vercel=UTC
    // 저장된 인스턴트 = 2026-01-31T23:30:00Z. UTC getter → 2026-01 ✓
    expect(ymOf(new Date('2026-01-31T23:30:00Z'))).toBe('2026-01')
  })

  test('월말 마지막 순간 UTC 23:59:59 → 같은 달 버킷', () => {
    expect(ymOf(new Date('2026-03-31T23:59:59Z'))).toBe('2026-03')
  })

  test('다음 달 첫날 UTC 00:00:00 → 다음 달 버킷', () => {
    expect(ymOf(new Date('2026-04-01T00:00:00Z'))).toBe('2026-04')
  })
})

describe('nowYmKst — 현재 KST 월', () => {
  test('UTC 15:00(=KST 다음날 00:00) → KST 다음날 기준 월 버킷', () => {
    // 2026-01-31T15:00:00Z = KST 2026-02-01 00:00 → 월 = 2026-02
    const fakeNow = new Date('2026-01-31T15:00:00Z').getTime()
    jest.spyOn(Date, 'now').mockReturnValue(fakeNow)
    expect(nowYmKst()).toBe('2026-02')
    jest.restoreAllMocks()
  })

  test('UTC 14:59:59(=KST 2026-01-31 23:59:59) → 2026-01 버킷', () => {
    // KST = UTC+9. 2026-01-31T14:59:59Z + 9h = 2026-01-31T23:59:59 KST → 월 = 2026-01
    const fakeNow = new Date('2026-01-31T14:59:59Z').getTime()
    jest.spyOn(Date, 'now').mockReturnValue(fakeNow)
    expect(nowYmKst()).toBe('2026-01')
    jest.restoreAllMocks()
  })

  test('연초 경계: UTC 2025-12-31T15:00:00Z(=KST 2026-01-01 00:00) → 2026-01', () => {
    const fakeNow = new Date('2025-12-31T15:00:00Z').getTime()
    jest.spyOn(Date, 'now').mockReturnValue(fakeNow)
    expect(nowYmKst()).toBe('2026-01')
    jest.restoreAllMocks()
  })
})
