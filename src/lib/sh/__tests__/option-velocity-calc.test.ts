import {
  DEFAULT_STATUS_THRESHOLDS,
  judgeReplenishmentStatus,
  suggestProductionQty,
  suggestReplenishQty,
} from '@/lib/sh/option-velocity-query'

describe('suggestReplenishQty', () => {
  it('목표+리드타임 수요 + 안전재고 − 로켓재고를 올림한다', () => {
    // 2/일 × (30+7) + 10 − 30 = 54
    expect(
      suggestReplenishQty({
        rocketDailyVelocityRaw: 2,
        targetCoverDays: 30,
        leadTimeDays: 7,
        safetyStockQty: 10,
        rocketGrowthQty: 30,
      })
    ).toBe(54)
  })

  it('재고가 충분하면 0 (음수 금지)', () => {
    expect(
      suggestReplenishQty({
        rocketDailyVelocityRaw: 0.5,
        targetCoverDays: 30,
        leadTimeDays: 7,
        safetyStockQty: 0,
        rocketGrowthQty: 100,
      })
    ).toBe(0)
  })

  it('targetCoverDays=0 이면 calculateReorder 공식(리드타임 도달분)과 일치한다', () => {
    // velocity 1.5 × 7 + 5 − 3 = 12.5 → ceil 13
    expect(
      suggestReplenishQty({
        rocketDailyVelocityRaw: 1.5,
        targetCoverDays: 0,
        leadTimeDays: 7,
        safetyStockQty: 5,
        rocketGrowthQty: 3,
      })
    ).toBe(13)
  })
})

describe('suggestProductionQty', () => {
  it('전사 가용 + 입고예정을 모두 차감한다', () => {
    // 3/일 × 37 + 10 − 80 − 20 = 21
    expect(
      suggestProductionQty({
        totalDailyVelocityRaw: 3,
        targetCoverDays: 30,
        leadTimeDays: 7,
        safetyStockQty: 10,
        totalAvailableQty: 80,
        incomingQty: 20,
      })
    ).toBe(21)
  })
})

describe('judgeReplenishmentStatus', () => {
  const t = DEFAULT_STATUS_THRESHOLDS

  it('판매 0 → NO_SALES', () => {
    expect(
      judgeReplenishmentStatus({
        rocketDailyVelocity: 0,
        rocketGrowthQty: 50,
        daysOfCoverRocketGrowth: null,
        thresholds: t,
      }).status
    ).toBe('NO_SALES')
  })

  it('판매 중인데 로켓 재고 0 → OUT_OF_STOCK_RISK', () => {
    expect(
      judgeReplenishmentStatus({
        rocketDailyVelocity: 2,
        rocketGrowthQty: 0,
        daysOfCoverRocketGrowth: null,
        thresholds: t,
      }).status
    ).toBe('OUT_OF_STOCK_RISK')
  })

  it('임계 경계: 7일 미만=RISK, 7~20=REPLENISH, 21~29=WATCH, 30+=OK', () => {
    const at = (days: number) =>
      judgeReplenishmentStatus({
        rocketDailyVelocity: 1,
        rocketGrowthQty: days,
        daysOfCoverRocketGrowth: days,
        thresholds: t,
      }).status
    expect(at(6.9)).toBe('OUT_OF_STOCK_RISK')
    expect(at(7)).toBe('REPLENISH')
    expect(at(20.9)).toBe('REPLENISH')
    expect(at(21)).toBe('WATCH')
    expect(at(29.9)).toBe('WATCH')
    expect(at(30)).toBe('OK')
  })

  it('임계값 파라미터가 판정에 반영된다', () => {
    expect(
      judgeReplenishmentStatus({
        rocketDailyVelocity: 1,
        rocketGrowthQty: 10,
        daysOfCoverRocketGrowth: 10,
        thresholds: { outOfStockRiskDays: 14, replenishDays: 28, watchDays: 45 },
      }).status
    ).toBe('OUT_OF_STOCK_RISK')
  })
})
