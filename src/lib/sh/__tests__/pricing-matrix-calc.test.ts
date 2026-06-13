// @jest-environment node
// 가격 매트릭스 계산 라이브러리 단위 테스트

import {
  calculateMatrix,
  optionToBundle,
  type MatrixBundle,
  type MatrixChannel,
  type MatrixPromotion,
  type MatrixGlobals,
  type MatrixInputs,
} from '../pricing-matrix-calc'
import type { TierThresholds } from '../margin-tier'

// ─── 공통 픽스처 ─────────────────────────────────────────────────────────────

const channel: MatrixChannel = {
  channelType: 'OPEN_MARKET',
  feeRates: [{ categoryName: '기본', ratePercent: 10 }], // 10%
  paymentFeeIncluded: false,
  paymentFeePct: 0.03, // 3%
  applyAdCost: true,
  shippingFee: 3000,
  freeShippingThreshold: 30000, // 3만원 이상 무료배송
}

const noThresholdChannel: MatrixChannel = {
  ...channel,
  freeShippingThreshold: null, // 배송비 임계값 없음
  shippingFee: 3000,
}

const globals: MatrixGlobals = {
  includeVat: true,
  vatRate: 0.1,
  adCostPct: 0.05, // 5%
  operatingCostPct: 0.03, // 3%
  applyReturnAdjustment: false,
  expectedReturnRate: 0.05,
  returnHandlingCost: 5000,
  minimumAcceptableMargin: 0.1,
}

const thresholds: TierThresholds = {
  platformTargetGood: 0.25,
  platformTargetFair: 0.15,
}

const noPromotion: MatrixPromotion = { type: 'NONE', value: 0 }

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

function makeBundle(
  costPrice: number,
  salePrice: number,
  qty = 1,
  packagingCost = 2000
): MatrixBundle {
  return {
    components: [{ costPrice, retailPrice: salePrice, quantity: qty }],
    packagingCost,
    salePrice,
  }
}

function makeInputs(
  bundle: MatrixBundle,
  ch: MatrixChannel = channel,
  promo: MatrixPromotion = noPromotion
): MatrixInputs {
  return { bundle, channel: ch, promotion: promo, globals, thresholds }
}

// ─── Test 1: 솔버 라운드트립 (good/fair/min) ─────────────────────────────────

describe('calcRecommendedRetail 라운드트립', () => {
  const bundle = makeBundle(15000, 40000, 1)

  test('good 추천가를 0% 할인 셀에 넣으면 마진 >= platformTargetGood - epsilon', () => {
    const result = calculateMatrix(makeInputs(bundle))
    const { good } = result.recommendedRetail
    expect(good).not.toBeNull()

    // 추천가를 salePrice로 사용해 0% 할인 셀 검증
    const checkBundle: MatrixBundle = { ...bundle, salePrice: good! }
    const checkResult = calculateMatrix(makeInputs(checkBundle))
    const cell0 = checkResult.cells[0] // discountRate=0
    expect(cell0.margin).toBeGreaterThanOrEqual(thresholds.platformTargetGood - 0.005)
  })

  test('fair 추천가를 0% 할인 셀에 넣으면 마진 >= platformTargetFair - epsilon', () => {
    const result = calculateMatrix(makeInputs(bundle))
    const { fair } = result.recommendedRetail
    expect(fair).not.toBeNull()

    const checkBundle: MatrixBundle = { ...bundle, salePrice: fair! }
    const checkResult = calculateMatrix(makeInputs(checkBundle))
    const cell0 = checkResult.cells[0]
    expect(cell0.margin).toBeGreaterThanOrEqual(thresholds.platformTargetFair - 0.005)
  })

  test('min 추천가를 0% 할인 셀에 넣으면 마진 >= minimumAcceptableMargin - epsilon', () => {
    const result = calculateMatrix(makeInputs(bundle))
    const { min } = result.recommendedRetail
    expect(min).not.toBeNull()

    const checkBundle: MatrixBundle = { ...bundle, salePrice: min! }
    const checkResult = calculateMatrix(makeInputs(checkBundle))
    const cell0 = checkResult.cells[0]
    expect(cell0.margin).toBeGreaterThanOrEqual(globals.minimumAcceptableMargin - 0.005)
  })

  test('recommendedRetailForGoodMargin은 recommendedRetail.good의 alias', () => {
    const result = calculateMatrix(makeInputs(bundle))
    expect(result.recommendedRetailForGoodMargin).toBe(result.recommendedRetail.good)
  })
})

// ─── Test 2: 단일 컴포넌트 번들 == 레거시 단일 옵션 수식 ─────────────────────

describe('1-컴포넌트 번들 == 레거시 옵션 동등성', () => {
  // 구체적인 수치 케이스:
  // salePrice=40000, cost=15000, qty=1, packaging=2000
  // channel: fee=10%, paymentFee=3%, adCost=5%, op=3%, threshold=30000, shipping=3000
  // 0% 할인, VAT 10% 포함, 프로모션 없음
  //
  // 수작업 계산:
  //   finalPrice = 40000
  //   nominalRevenue = 40000 / 1.1 ≈ 36363.64 → r2 = 36363.64
  //   channelFee = 36363.64 * 0.10 = 3636.36 → r2 = 3636.36
  //   paymentFee = 36363.64 * 0.03 = 1090.91 → r2 = 1090.91
  //   adCost = 36363.64 * 0.05 = 1818.18 → r2 = 1818.18
  //   operating = 36363.64 * 0.03 = 1090.91 → r2 = 1090.91
  //   packaging = 2000
  //   shipping = 3000 (finalPrice 40000 >= threshold 30000)
  //   setCost = 15000 * 1 = 15000
  //   totalCost = 15000 + 3636.36 + 1090.91 + 1818.18 + 1090.91 + 2000 + 3000 = 27636.36
  //   netProfit = r2(36363.64 - 27636.36) = r2(8727.28) = 8727.28
  //   margin = r4(8727.28 / 36363.64) ≈ 0.2400

  const bundle = makeBundle(15000, 40000, 1, 2000)

  test('순이익이 유한한 양수', () => {
    const result = calculateMatrix(makeInputs(bundle))
    const cell0 = result.cells[0]
    expect(Number.isFinite(cell0.netProfit)).toBe(true)
    expect(cell0.netProfit).toBeGreaterThan(0)
  })

  test('0% 할인 셀 순이익 수작업 값과 일치 (±1원 허용)', () => {
    const result = calculateMatrix(makeInputs(bundle))
    const cell0 = result.cells[0]
    // 수작업: 8727.28
    expect(cell0.netProfit).toBeCloseTo(8727.28, 1)
  })

  test('optionToBundle 변환 후 결과가 직접 번들과 동일', () => {
    const option = {
      retailPrice: 40000,
      costPrice: 15000,
      unitsPerSet: 1,
      packagingCost: 2000,
    }
    const converted = optionToBundle(option)
    const bundleDirect = makeBundle(15000, 40000, 1, 2000)

    const resultConverted = calculateMatrix(makeInputs(converted))
    const resultDirect = calculateMatrix(makeInputs(bundleDirect))

    expect(resultConverted.cells[0].margin).toBeCloseTo(resultDirect.cells[0].margin, 4)
    expect(resultConverted.cells[0].netProfit).toBeCloseTo(resultDirect.cells[0].netProfit, 2)
  })

  test('perUnitProfit은 netProfit / totalUnits (qty=3 케이스)', () => {
    // 3개 세트 번들
    const b3: MatrixBundle = {
      components: [{ costPrice: 5000, retailPrice: 13333, quantity: 3 }],
      packagingCost: 2000,
      salePrice: 40000,
    }
    const result = calculateMatrix(makeInputs(b3))
    const cell0 = result.cells[0]
    expect(cell0.perUnitProfit).toBeCloseTo(cell0.netProfit / 3, 1)
  })
})

// ─── Test 3: 무료배송 임계값 step function — 솔버 브랜치 일관성 ─────────────

describe('무료배송 임계값 브랜치 일관성', () => {
  // 임계값=30000. 배송비=3000.
  // 배송비 포함 케이스: 추천가 >= 30000 이면 A 브랜치가 self-consistent
  // 배송비 없음 케이스: 추천가 < 30000 이면 B 브랜치가 self-consistent

  test('null threshold 채널에서는 배송비=0 (calcCell과 일치)', () => {
    const bundle = makeBundle(15000, 40000, 1, 2000)
    const result = calculateMatrix(makeInputs(bundle, noThresholdChannel))
    // threshold=null이므로 0% 할인 셀의 배송비=0
    expect(result.cells[0].shipping).toBe(0)
  })

  test('null threshold 채널 솔버 라운드트립 — 배송비 0 반영', () => {
    const bundle = makeBundle(15000, 40000, 1, 2000)
    const result = calculateMatrix(makeInputs(bundle, noThresholdChannel))
    const { good } = result.recommendedRetail
    expect(good).not.toBeNull()

    // 추천가로 0% 할인 셀 검증
    const checkBundle: MatrixBundle = { ...bundle, salePrice: good! }
    const checkResult = calculateMatrix(makeInputs(checkBundle, noThresholdChannel))
    expect(checkResult.cells[0].shipping).toBe(0)
    expect(checkResult.cells[0].margin).toBeGreaterThanOrEqual(
      thresholds.platformTargetGood - 0.005
    )
  })

  test('threshold > 0: 선택된 브랜치의 추천가가 threshold 가정과 자기일치', () => {
    // 원가가 높아 추천가가 threshold(30000) 위에 오도록 세팅
    const expensiveBundle = makeBundle(25000, 50000, 1, 3000)
    const result = calculateMatrix(makeInputs(expensiveBundle, channel))
    const { good } = result.recommendedRetail
    expect(good).not.toBeNull()
    // 추천가 >= threshold면 솔버가 배송비 포함(A) 브랜치를 선택한 것
    // 라운드트립: 해당 추천가로 셀을 계산해도 마진 달성
    const checkBundle: MatrixBundle = { ...expensiveBundle, salePrice: good! }
    const checkResult = calculateMatrix(makeInputs(checkBundle, channel))
    expect(checkResult.cells[0].margin).toBeGreaterThanOrEqual(
      thresholds.platformTargetGood - 0.005
    )
  })
})

// ─── Test 4: MIN_PRICE 프로모션 — targetAchievableUnderPromotion ─────────────

describe('targetAchievableUnderPromotion', () => {
  const bundle = makeBundle(15000, 40000, 1, 2000)

  test('프로모션 없으면 good 추천가에서 true', () => {
    const result = calculateMatrix(makeInputs(bundle, channel, noPromotion))
    expect(result.targetAchievableUnderPromotion).toBe(true)
  })

  test('MIN_PRICE 프로모션이 추천가 아래로 강제 인하하면 false', () => {
    // good 추천가를 먼저 구한 뒤, 그보다 낮은 MIN_PRICE로 강제 인하
    const baseResult = calculateMatrix(makeInputs(bundle, channel, noPromotion))
    const good = baseResult.recommendedRetail.good!

    // MIN_PRICE를 good 추천가의 70%로 설정 → 마진 달성 불가
    const lowCapPromo: MatrixPromotion = {
      type: 'MIN_PRICE',
      value: Math.round(good * 0.7),
    }
    const result = calculateMatrix(makeInputs(bundle, channel, lowCapPromo))
    expect(result.targetAchievableUnderPromotion).toBe(false)
  })

  test('구조적으로 달성 불가(good=null)이면 false', () => {
    // 수수료·운영비·광고비 합이 너무 높아 구조적 달성 불가 케이스
    const impossibleChannel: MatrixChannel = {
      ...channel,
      feeRates: [{ categoryName: '기본', ratePercent: 80 }], // 80% 수수료
    }
    const result = calculateMatrix(makeInputs(bundle, impossibleChannel, noPromotion))
    expect(result.recommendedRetail.good).toBeNull()
    expect(result.targetAchievableUnderPromotion).toBe(false)
  })
})
