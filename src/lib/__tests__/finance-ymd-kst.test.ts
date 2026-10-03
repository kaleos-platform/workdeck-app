// @jest-environment node
/**
 * ymdOf — 화면 날짜 표시의 KST 경계 회귀 테스트.
 *
 * 저장 규약: txnDate는 "KST 벽시계 자릿수를 UTC로 저장"(aggregate.ts ymOf 주석).
 * 따라서 UTC getter로 읽어야 달력일이 복원된다. 로컬 getter로 읽으면 브라우저가
 * KST일 때 +9h 되어 15시 이후 거래가 전부 다음날로 보인다.
 *
 * TZ를 Asia/Seoul로 고정하는 이유: UTC 러너에서는 잘못된(로컬 getter) 구현도
 * 통과해버려 회귀를 못 잡는다. 여기서는 어느 환경에서든 실패해야 한다.
 */
process.env.TZ = 'Asia/Seoul'

import { ymdOf } from '@/lib/finance/aggregate'

describe('ymdOf — KST 벽시계 저장 규약 기반 날짜 표시', () => {
  test('신고된 거래: 2026-08-01 20:23:23 → 8월 1일 (8월 2일 아님)', () => {
    // 신한 주거래 출금 8,000,000 / 잔액 11,753,576. 로컬 getter면 KST에서 '2026-08-02'가 된다.
    expect(ymdOf('2026-08-01T20:23:23.000Z')).toBe('2026-08-01')
  })

  test('15시 경계 — 하루가 밀리기 시작하던 지점', () => {
    expect(ymdOf('2026-08-01T14:59:59.000Z')).toBe('2026-08-01')
    expect(ymdOf('2026-08-01T15:00:00.000Z')).toBe('2026-08-01')
  })

  test('월말 23:59:59 — 다음 달로 새지 않는다', () => {
    expect(ymdOf('2026-08-31T23:59:59.000Z')).toBe('2026-08-31')
  })

  test('연말 경계', () => {
    expect(ymdOf('2026-12-31T22:00:00.000Z')).toBe('2026-12-31')
  })

  test('자정 — 전날로 새지 않는다', () => {
    expect(ymdOf('2026-08-01T00:00:00.000Z')).toBe('2026-08-01')
  })
})
