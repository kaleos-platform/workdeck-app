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

// ─── Test 2: gross-basis 셀 계산 (수수료=판매가 기준, 마진 분모=공급가) ────────

describe('gross-basis 0% 할인 셀 수작업 검증', () => {
  // 구체적인 수치 케이스:
  // salePrice=40000, cost=15000, qty=1, packaging=2000
  // channel: fee=10%, paymentFee=3%, adCost=5%, threshold=30000, shipping=3000
  // 0% 할인, VAT 10% 포함, 프로모션 없음
  // applyReturnAdjustment=false → returnCost=0. 운영비는 신 모델에서 미사용(0).
  //
  // 수작업 계산 (gross 모델 — 수수료/PG/광고는 finalPrice 기준):
  //   finalPrice = 40000
  //   nominalRevenue(공급가) = 40000 / 1.1 ≈ 36363.64
  //   vat = 40000 − 36363.64 = 3636.36
  //   channelFee = 40000 * 0.10 = 4000
  //   paymentFee = 40000 * 0.03 = 1200
  //   adCost = 40000 * 0.05 = 2000
  //   operating = 0
  //   packaging = 2000
  //   shipping = 3000 (finalPrice 40000 >= threshold 30000)
  //   setCost(cogs) = 15000
  //   totalCost = 15000 + 4000 + 1200 + 2000 + 0 + 2000 + 3000 = 27200
  //   netProfit = r2(36363.64 − 27200) = 9163.64
  //   margin = r4(9163.64 / 36363.64) ≈ 0.2520

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
    // 수작업: 9163.64
    expect(cell0.netProfit).toBeCloseTo(9163.64, 1)
  })

  test('수수료는 판매가(gross) 기준, cogs·vat 노출, 운영비 0', () => {
    const result = calculateMatrix(makeInputs(bundle))
    const c = result.cells[0]
    expect(c.channelFee).toBeCloseTo(4000, 2) // 40000 × 10% (gross)
    expect(c.paymentFee).toBeCloseTo(1200, 2) // 40000 × 3%
    expect(c.adCost).toBeCloseTo(2000, 2) // 40000 × 5%
    expect(c.cogs).toBeCloseTo(15000, 2)
    expect(c.vat).toBeCloseTo(3636.36, 1) // 40000 − 공급가
    expect(c.operating).toBe(0)
    expect(c.revenue).toBeCloseTo(36363.64, 1) // 마진 분모 = 공급가
    expect(c.margin).toBeCloseTo(0.252, 3)
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

// ─── Test 5: 조건부 할인 — FLAT/PERCENT minThreshold ──────────────────────────

describe('조건부 할인 (minThreshold)', () => {
  // salePrice 60000 기준. cells[0]=0% 할인 → p=60000, cells[10]=50% 할인 → p=30000.
  // threshold 50000 → 0% 셀은 충족(p=60000>=50000), 50% 셀은 미충족(p=30000<50000).
  const bundle = makeBundle(20000, 60000, 1, 2000)
  const ch = noThresholdChannel // 무료배송 분기 노이즈 제거

  test('FLAT: 임계 충족 셀만 차감, 미달 셀은 컬럼 할인만', () => {
    const promoCond: MatrixPromotion = { type: 'FLAT', value: 2000, minThreshold: 50000 }
    const promoNone: MatrixPromotion = { type: 'NONE', value: 0 }
    const cond = calculateMatrix(makeInputs(bundle, ch, promoCond))
    const none = calculateMatrix(makeInputs(bundle, ch, promoNone))

    // cells[0]: 0% 할인 → p=60000 >= 50000 → 2000 차감 적용
    expect(cond.cells[0].finalPrice).toBe(60000 - 2000)
    // cells[10]: 50% 할인 → p=30000 < 50000 → 미적용 (컬럼 할인만, NONE과 동일)
    expect(cond.cells[10].finalPrice).toBe(none.cells[10].finalPrice)
    expect(none.cells[10].finalPrice).toBe(30000)
  })

  test('FLAT: minThreshold 미설정이면 전 셀 적용 (무조건 = 기존 동치)', () => {
    const promoUncond: MatrixPromotion = { type: 'FLAT', value: 2000 }
    const promoZero: MatrixPromotion = { type: 'FLAT', value: 2000, minThreshold: 0 }
    const uncond = calculateMatrix(makeInputs(bundle, ch, promoUncond))
    const zero = calculateMatrix(makeInputs(bundle, ch, promoZero))

    // 모든 셀에서 2000 차감 (조건 없음)
    expect(uncond.cells[0].finalPrice).toBe(60000 - 2000)
    expect(uncond.cells[10].finalPrice).toBe(30000 - 2000)
    // minThreshold:0 == 미설정
    expect(zero.cells[10].finalPrice).toBe(uncond.cells[10].finalPrice)
  })

  test('PERCENT: 임계 충족 셀만 차감', () => {
    const promoCond: MatrixPromotion = { type: 'PERCENT', value: 0.1, minThreshold: 50000 }
    const cond = calculateMatrix(makeInputs(bundle, ch, promoCond))

    // cells[0]: p=60000 >= 50000 → 10% 차감 → 54000
    expect(cond.cells[0].finalPrice).toBe(60000 * 0.9)
    // cells[10]: p=30000 < 50000 → 미적용 → 30000
    expect(cond.cells[10].finalPrice).toBe(30000)
  })

  test('COUPON: minThreshold 무관 (항상 적용)', () => {
    // COUPON은 조건부 대상 아님 — minThreshold가 있어도 무시하고 무조건 차감
    const promoCoupon: MatrixPromotion = { type: 'COUPON', value: 2000, minThreshold: 50000 }
    const coupon = calculateMatrix(makeInputs(bundle, ch, promoCoupon))

    // cells[10]: p=30000 < 50000 이지만 COUPON은 무조건 차감 → 28000
    expect(coupon.cells[10].finalPrice).toBe(30000 - 2000)
  })
})

// ─── Test 6: 스크린샷 시안 회귀 벡터 (gross 모델 권장가 역산) ──────────────────

describe('스크린샷 시안 회귀 벡터 — 목표마진 30% 권장가', () => {
  // 시안 공통값: 원가 62,000 · 물류 3,000 · 반품처리비 6,000 × 반품율 15% = 900
  //   VAT 10% 포함 · 목표마진(good) 30%. 채널별 Σfee% = 채널수수료 + 광고 + PG.
  //   권장가(good) 역산 → 0% 셀에 넣으면 마진 정확히 30.0%.
  // 검증 앵커 (수식 재현 시 일치해야 함):
  //   쿠팡   Σfee=0.208 → P≈153,841 → 마진 ₩41,957 / 30.0%
  //   네이버 Σfee=0.115 → P≈126,399 → 마진 ₩34,473 / 30.0%
  //   무신사 Σfee=0.34  → P≈222,362 → 마진 ₩60,644 / 30.0%
  const screenshotGlobals: MatrixGlobals = {
    includeVat: true,
    vatRate: 0.1,
    adCostPct: 0, // 채널별 applyAdCost로 결정 — 채널 fixture에서 ad는 fee에 미포함, 아래 adCostPct로 주입
    operatingCostPct: 0,
    applyReturnAdjustment: true,
    expectedReturnRate: 0.15,
    returnHandlingCost: 6000,
    minimumAcceptableMargin: 0.12,
  }
  const screenshotThresholds: TierThresholds = {
    platformTargetGood: 0.3,
    platformTargetFair: 0.2,
  }
  // 원가 62,000 · 물류 3,000(threshold 0 → 항상 부담) · 포장 0
  const ssBundle: MatrixBundle = {
    components: [{ costPrice: 62000, retailPrice: 189000, quantity: 1 }],
    packagingCost: 0,
    salePrice: 0, // 권장가로 오버라이드
  }
  function ssChannel(channelFeePct: number, adPct: number): MatrixChannel {
    return {
      channelType: 'OPEN_MARKET',
      feeRates: [{ categoryName: '기본', ratePercent: channelFeePct * 100 }],
      paymentFeeIncluded: false,
      paymentFeePct: 0.02, // PG 2%
      applyAdCost: true,
      shippingFee: 3000,
      freeShippingThreshold: 1, // 물류비 항상 부담 (>0, 모든 가격이 초과)
    }
  }
  // adCostPct는 globals 공유값이므로 채널별로 globals를 복제해 주입
  function ssInputs(channelFeePct: number, adPct: number): MatrixInputs {
    return {
      bundle: ssBundle,
      channel: ssChannel(channelFeePct, adPct),
      promotion: noPromotion,
      globals: { ...screenshotGlobals, adCostPct: adPct },
      thresholds: screenshotThresholds,
    }
  }

  const cases = [
    { name: '쿠팡', channelFee: 0.108, ad: 0.08, expectP: 153841, expectMargin: 41957 },
    { name: '네이버', channelFee: 0.035, ad: 0.06, expectP: 126399, expectMargin: 34473 },
    { name: '무신사', channelFee: 0.28, ad: 0.04, expectP: 222362, expectMargin: 60644 },
  ]

  for (const c of cases) {
    test(`${c.name}: good 권장가 ≈ ${c.expectP}원, 0% 셀 마진 30.0%`, () => {
      const inputs = ssInputs(c.channelFee, c.ad)
      const result = calculateMatrix(inputs)
      const good = result.recommendedRetail.good
      expect(good).not.toBeNull()
      // 권장가 ±2원 (반올림)
      expect(good!).toBeCloseTo(c.expectP, -1)

      // 권장가를 salePrice로 넣어 0% 셀 검증
      const checkBundle: MatrixBundle = { ...ssBundle, salePrice: good! }
      const cell = calculateMatrix({ ...inputs, bundle: checkBundle }).cells[0]
      expect(cell.margin).toBeCloseTo(0.3, 3) // 정확히 30.0%
      expect(cell.netProfit).toBeCloseTo(c.expectMargin, -1)
    })
  }

  // ── board-card 계산 경로 회귀 (헤드라인 NONE vs 프로모션 실제 분리) ──────────
  // PricingChannelBoardCard 가 헤드라인 cell(프로모션 NONE)과 promoCell(실제)을
  // 분리 계산해야 게이지 fill이 0이 아니고 헤드라인 마진이 프로모션에 왜곡되지 않는다.
  describe('board-card 헤드라인/프로모션 분리', () => {
    const inputs = ssInputs(0.108, 0.08) // 쿠팡
    const good = calculateMatrix(inputs).recommendedRetail.good!
    const atRecommended = (promo: MatrixPromotion) =>
      calculateMatrix({ ...inputs, bundle: { ...ssBundle, salePrice: good }, promotion: promo })

    test('헤드라인(NONE)은 정확히 목표 마진 30%', () => {
      const headline = atRecommended({ type: 'NONE', value: 0 })
      expect(headline.cells[0].margin).toBeCloseTo(0.3, 3)
    })

    test('프로모션 10% 적용 셀은 헤드라인보다 낮은 판매가·마진 (게이지 fill > 0)', () => {
      const headline = atRecommended({ type: 'NONE', value: 0 }).cells[0]
      const promo = atRecommended({ type: 'PERCENT', value: 0.1 }).cells[0]
      // 프로모션가 < 헤드라인가 → currentDiscount > 0
      expect(promo.finalPrice).toBeLessThan(headline.finalPrice)
      const currentDiscount = 1 - promo.finalPrice / headline.finalPrice
      expect(currentDiscount).toBeGreaterThan(0.05)
      // 프로모션 마진 < 헤드라인 마진
      expect(promo.margin).toBeLessThan(headline.margin)
    })
  })
})
