import {
  discountRate,
  endsAtPeriodEnd,
  firstChargeAfterTrial,
  formatTrialEndDate,
  nextCycleSupplyTotal,
  trialDday,
} from '../billing-shared'
import type { SubscriptionItemDto } from '../billing-shared'

function item(
  deckAppId: string,
  status: SubscriptionItemDto['status'],
  priceSnapshot = 50000
): SubscriptionItemDto {
  return { id: `i-${deckAppId}`, deckAppId, priceSnapshot, status }
}

// prod 에서 "구독 중 / 다음 결제일 · 월 0원" 이 노출된 회귀.
// 유일한 아이템이 CANCEL_AT_PERIOD_END 라 다음 주기 청구가 0이었는데,
// 배지는 계속 "구독 중" 이었다.
describe('구독 상태 표시 판정', () => {
  test('다음 주기 청구액은 ACTIVE 아이템만 합산', () => {
    expect(
      nextCycleSupplyTotal([item('seller-hub', 'ACTIVE'), item('finance', 'ACTIVE', 40000)])
    ).toBe(90000)
    expect(
      nextCycleSupplyTotal([
        item('seller-hub', 'ACTIVE'),
        item('finance', 'CANCEL_AT_PERIOD_END', 40000),
      ])
    ).toBe(50000)
  })

  test('전부 해지 예약이면 주기 말에 구독이 종료된다', () => {
    expect(endsAtPeriodEnd([item('seller-hub', 'CANCEL_AT_PERIOD_END')])).toBe(true)
    expect(nextCycleSupplyTotal([item('seller-hub', 'CANCEL_AT_PERIOD_END')])).toBe(0)
  })

  test('ACTIVE 가 하나라도 남으면 구독은 유지된다', () => {
    expect(
      endsAtPeriodEnd([item('seller-hub', 'ACTIVE'), item('finance', 'CANCEL_AT_PERIOD_END')])
    ).toBe(false)
  })

  test('아이템이 없으면 종료 판정을 하지 않는다 (구독 시작 전)', () => {
    expect(endsAtPeriodEnd([])).toBe(false)
    expect(nextCycleSupplyTotal([])).toBe(0)
  })
})

describe('체험 D-Day', () => {
  // 체험 종료 시각은 exclusive: 11/21 00:00 KST 종료 = 마지막 이용일 11/20
  const end = '2026-11-20T15:00:00.000Z'
  test('마지막 이용일 당일은 D-Day 이고 강조된다', () => {
    expect(trialDday(end, new Date('2026-11-20T00:30:00+09:00'))).toEqual({
      label: 'D-Day',
      urgent: true,
    })
  })
  test('KST 자정 경계: 전날 23:59 는 D-1, 당일 00:00 은 D-Day', () => {
    expect(trialDday(end, new Date('2026-11-19T23:59:59+09:00'))?.label).toBe('D-1')
    expect(trialDday(end, new Date('2026-11-20T00:00:00+09:00'))?.label).toBe('D-Day')
  })
  test('D-3 까지 강조, D-4 는 강조하지 않는다', () => {
    expect(trialDday(end, new Date('2026-11-17T12:00:00+09:00'))).toEqual({
      label: 'D-3',
      urgent: true,
    })
    expect(trialDday(end, new Date('2026-11-16T12:00:00+09:00'))).toEqual({
      label: 'D-4',
      urgent: false,
    })
  })
  test('종료 시각이 지나면 null', () => {
    expect(trialDday(end, new Date('2026-11-21T00:00:00+09:00'))).toBeNull()
  })
  test('표시 종료일과 D-Day 날짜가 같다', () => {
    expect(formatTrialEndDate(end)).toBe('2026년 11월 20일')
  })
})

describe('예약 반영 다음 결제액', () => {
  const items = [
    { id: 'a', deckAppId: 'finance', priceSnapshot: 20000, status: 'ACTIVE' as const },
    {
      id: 'b',
      deckAppId: 'recruiting',
      priceSnapshot: 10000,
      status: 'ACTIVE' as const,
      awaitingTrialEnd: true,
    },
  ]
  test('다음 결제일보다 체험이 늦게 끝나는 예약은 제외', () => {
    expect(nextCycleSupplyTotal(items, '2026-12-01T00:00:00Z', () => '2026-12-05T00:00:00Z')).toBe(
      20000
    )
  })
  test('결제일 전에 체험이 끝나는 예약은 포함', () => {
    expect(nextCycleSupplyTotal(items, '2026-12-01T00:00:00Z', () => '2026-11-25T00:00:00Z')).toBe(
      30000
    )
  })
})

describe('체험 종료 후 첫 결제일(정기결제 cron 09:00 KST)', () => {
  test('09시 이후 종료면 다음 날 09시', () => {
    expect(firstChargeAfterTrial('2026-11-22T05:30:00.000Z')).toBe('2026-11-23T00:00:00.000Z')
  })
  test('09시 이전 종료면 같은 날 09시', () => {
    expect(firstChargeAfterTrial('2026-11-21T23:00:00.000Z')).toBe('2026-11-22T00:00:00.000Z')
  })
  test('정확히 09시 종료면 그 실행에서 결제', () => {
    expect(firstChargeAfterTrial('2026-11-22T00:00:00.000Z')).toBe('2026-11-22T00:00:00.000Z')
  })
})

describe('discountRate — 쇼핑몰식 할인율(표시 금액 기준, 소수점 버림)', () => {
  test('정가 22,000원 → 13,500원은 38%', () => {
    expect(discountRate(22000, 13500)).toBe(38)
  })
  test('할인이 없거나 정가가 0이면 null', () => {
    expect(discountRate(22000, 22000)).toBeNull()
    expect(discountRate(22000, 25000)).toBeNull()
    expect(discountRate(0, 0)).toBeNull()
  })
})
