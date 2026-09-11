import { endsAtPeriodEnd, nextCycleSupplyTotal } from '../billing-shared'
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

  test('전부 해제 예약이면 주기 말에 구독이 종료된다', () => {
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
