/** @jest-environment node */
import { deriveMonthEndSnapshots, yearMonth } from '../snapshots'

/**
 * txnDate는 "KST 벽시계 자릿수를 UTC로 저장"하는 규약이라 Prisma가 돌려주는 값은 항상
 * UTC 인스턴트다. TZ 없는 문자열은 로컬 해석되어 실행 머신 TZ에 따라 결과가 달라지므로
 * 픽스처에 Z를 명시한다(이 전제가 어긋나 KST 머신에서만 깨지던 테스트였다).
 */
const d = (iso: string) => new Date(`${iso}Z`)

describe('yearMonth — UTC getter 기반 "YYYY-MM"', () => {
  test('한 자리 월은 0 패딩', () => {
    expect(yearMonth(d('2026-03-09T10:00:00'))).toBe('2026-03')
  })
})

describe('deriveMonthEndSnapshots — 월말 잔고 파생', () => {
  test('월별 마지막(최대 날짜) 거래의 잔액을 사용', () => {
    const out = deriveMonthEndSnapshots([
      { txnDate: d('2026-03-01T00:00:00'), balanceAfter: 100 },
      { txnDate: d('2026-03-20T00:00:00'), balanceAfter: 300 },
      { txnDate: d('2026-03-10T00:00:00'), balanceAfter: 200 },
    ])
    expect(out).toEqual([{ yearMonth: '2026-03', balance: 300 }])
  })

  test('입력 순서가 뒤섞여도 정렬 후 마지막 잔액 채택', () => {
    const out = deriveMonthEndSnapshots([
      { txnDate: d('2026-04-25T00:00:00'), balanceAfter: 999 },
      { txnDate: d('2026-04-02T00:00:00'), balanceAfter: 10 },
    ])
    expect(out).toEqual([{ yearMonth: '2026-04', balance: 999 }])
  })

  test('여러 달은 각 달의 월말 잔고로 분리', () => {
    const out = deriveMonthEndSnapshots([
      { txnDate: d('2026-01-31T00:00:00'), balanceAfter: 50 },
      { txnDate: d('2026-02-15T00:00:00'), balanceAfter: 80 },
    ])
    expect(out).toEqual([
      { yearMonth: '2026-01', balance: 50 },
      { yearMonth: '2026-02', balance: 80 },
    ])
  })

  test('balanceAfter null 거래는 무시(은행 외 계좌)', () => {
    const out = deriveMonthEndSnapshots([
      { txnDate: d('2026-05-10T00:00:00'), balanceAfter: null },
      { txnDate: d('2026-05-20T00:00:00'), balanceAfter: null },
    ])
    expect(out).toEqual([])
  })

  test('MANUAL 수기 입력 달은 파생에서 제외(보존)', () => {
    const out = deriveMonthEndSnapshots(
      [
        { txnDate: d('2026-06-30T00:00:00'), balanceAfter: 700 },
        { txnDate: d('2026-07-31T00:00:00'), balanceAfter: 800 },
      ],
      new Set(['2026-06'])
    )
    expect(out).toEqual([{ yearMonth: '2026-07', balance: 800 }])
  })

  test('빈 입력 → 빈 배열', () => {
    expect(deriveMonthEndSnapshots([])).toEqual([])
  })
})
