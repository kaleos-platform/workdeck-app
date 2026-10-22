/** @jest-environment node */
import { deriveMonthEndSnapshots, sortByBalanceChain, yearMonth } from '../snapshots'

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

describe('sortByBalanceChain — 같은 시각 거래는 잔액 체인 순서', () => {
  const t = (iso: string, direction: 'IN' | 'OUT', amount: number, balanceAfter: number) => ({
    txnDate: d(iso),
    direction,
    amount,
    balanceAfter,
  })

  test('통과성 입출금(같은 초 입금→출금)이 DB 순서로 뒤집혀 와도 월말=출금 후 잔액 (prod 디딤돌 2026-07)', () => {
    const out = deriveMonthEndSnapshots([
      t('2026-07-16T16:25:08', 'OUT', 5500000, 0),
      t('2026-07-24T18:13:08', 'OUT', 3121730, 0),
      t('2026-07-24T18:13:08', 'IN', 3121730, 3121730),
      t('2026-07-24T18:13:14', 'OUT', 378270, 0),
      t('2026-07-24T18:13:14', 'IN', 378270, 378270),
    ])
    expect(out).toEqual([{ yearMonth: '2026-07', balance: 0 }])
  })

  test('출금이 먼저 와도 직전 잔액에서 이어지는 순서로 (prod 성동구 보조금 2026-05)', () => {
    const ordered = sortByBalanceChain([
      t('2026-05-22T14:15:25', 'IN', 705000, 2430000),
      t('2026-05-22T14:19:53', 'OUT', 3750000, 1680000),
      t('2026-05-22T14:19:53', 'IN', 3000000, 5430000),
      t('2026-05-28T18:45:11', 'OUT', 6575000, 365000),
      t('2026-05-28T18:45:11', 'IN', 5260000, 6940000),
    ])
    expect(ordered.map((x) => x.balanceAfter)).toEqual([2430000, 5430000, 1680000, 6940000, 365000])
  })

  test('앞 거래가 없는 첫 그룹도 시작점이 하나면 체인 순서로', () => {
    const ordered = sortByBalanceChain([
      t('2026-05-22T14:19:53', 'OUT', 3750000, 1680000),
      t('2026-05-22T14:19:53', 'IN', 3000000, 5430000),
    ])
    expect(ordered.map((x) => x.balanceAfter)).toEqual([5430000, 1680000])
  })

  test('앞 잔액과 끊긴 그룹도 시작점이 하나면 체인 순서로 (prod 신한 새활용 2026-09-07, 그 사이 내역 누락)', () => {
    const ordered = sortByBalanceChain([
      t('2026-08-20T10:00:00', 'IN', 100, 13148825),
      t('2026-09-07T09:45:00', 'OUT', 8800000, 7977120),
      t('2026-09-07T09:45:00', 'IN', 6200000, 16777120),
    ])
    expect(ordered.map((x) => x.balanceAfter)).toEqual([13148825, 16777120, 7977120])
  })

  test('체인이 안 이어지면 원래 순서 유지', () => {
    const ordered = sortByBalanceChain([
      t('2026-05-01T00:00:00', 'IN', 100, 100),
      t('2026-05-02T00:00:00', 'IN', 5, 999),
      t('2026-05-02T00:00:00', 'OUT', 7, 888),
    ])
    expect(ordered.map((x) => x.balanceAfter)).toEqual([100, 999, 888])
  })
})
