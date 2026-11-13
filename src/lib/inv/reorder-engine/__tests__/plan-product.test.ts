import { computeProductPlan, kstYesterday, type PlanOptionInput } from '../index'

const NOW = new Date('2026-11-13T03:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

/** 어제부터 거꾸로 n일, i=0 이 가장 오래된 날 */
function qtyByDate(n: number, f: (i: number) => number): Record<string, number> {
  const last = Date.parse(`${kstYesterday(NOW)}T00:00:00Z`)
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const key = new Date(last - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10)
    out[key] = f(i)
  }
  return out
}

function opt(over: Partial<PlanOptionInput> & { optionId: string }): PlanOptionInput {
  return {
    qtyByDate: qtyByDate(90, () => 2),
    netByDate: {},
    rocketQtyInWindow: 0,
    totalQtyInWindow: 180,
    historyDays: 90,
    safetyStockQty: 0,
    stock: {
      onHandQty: 0,
      rocketOnHandQty: 0,
      incomingQty: 0,
      rocketIncomingQty: 0,
      returnGradeQty: 0,
    },
    biasFactor: 1,
    ...over,
  }
}

const product = {
  leadTimeDays: 20,
  targetCoverDays: 30,
  roundUnit: 1,
  windowDays: 90,
  configModel: null,
  layered: false,
}

describe('computeProductPlan', () => {
  it('(a) 커버일수 반영: rate 2, lead 20, cover 30, 재고 40, safety 10 → 70', () => {
    const [r] = computeProductPlan({
      options: [
        opt({
          optionId: 'a',
          safetyStockQty: 10,
          stock: {
            onHandQty: 40,
            rocketOnHandQty: 0,
            incomingQty: 0,
            rocketIncomingQty: 0,
            returnGradeQty: 0,
          },
        }),
      ],
      product: { ...product, overrideModel: 'MA30' },
      now: NOW,
    })
    expect(r.selectedModel).toBe('MA30')
    expect(r.dailyRate).toBeCloseTo(2)
    expect(r.suggestedQty).toBe(70)
    expect(r.finalQty).toBe(70)
    expect(r.targetCoverDays).toBe(30)
    expect(r.checkStock).toBe(false)
    expect(r.modelForecasts).toEqual(
      expect.objectContaining({
        selected: 'MA30',
        onHandQty: 40,
        incomingQty: 0,
        safetyStockQty: 10,
        horizonDays: 50,
        leadTimeDays: 20,
      })
    )
    expect(Object.keys(r.modelForecasts.rates).sort()).toEqual([
      'CROSTON',
      'MA30',
      'MA90',
      'MA_BLEND',
      'SES_TREND',
    ])
  })

  it('(c) 레이어드 로켓 비중 0 → 로켓분 0, 합 = 단일 계산', () => {
    const input = {
      options: [
        opt({
          optionId: 'a',
          safetyStockQty: 5,
          stock: {
            onHandQty: 12,
            rocketOnHandQty: 0,
            incomingQty: 3,
            rocketIncomingQty: 0,
            returnGradeQty: 0,
          },
        }),
      ],
      now: NOW,
    }
    const [single] = computeProductPlan({ ...input, product: { ...product, roundUnit: 10 } })
    const [layered] = computeProductPlan({
      ...input,
      product: { ...product, roundUnit: 10, layered: true },
    })
    expect(single.layered).toBeNull()
    expect(layered.layered).not.toBeNull()
    expect(layered.layered!.rocketExpectedSales).toBe(0)
    expect(layered.layered!.linkedLocationQty).toBe(0)
    expect(layered.finalQty).toBe(single.finalQty)
    expect(layered.layered!.remainingQty).toBe(single.finalQty)
  })

  it('(c-2) 연동 위치로 입고 대기 100 → 로켓 gross 100 상쇄, 레이어드 = 단일 = 0', () => {
    const input = {
      options: [
        opt({
          optionId: 'a',
          rocketQtyInWindow: 180,
          totalQtyInWindow: 180,
          stock: {
            onHandQty: 0,
            rocketOnHandQty: 0,
            incomingQty: 100,
            rocketIncomingQty: 100,
            returnGradeQty: 0,
          },
        }),
      ],
      now: NOW,
    }
    const p = { ...product, overrideModel: 'MA30' as const }
    const [single] = computeProductPlan({ ...input, product: p })
    const [layered] = computeProductPlan({ ...input, product: { ...p, layered: true } })
    expect(layered.layered!.rocketExpectedSales).toBeCloseTo(100)
    expect(single.finalQty).toBe(0)
    expect(layered.layered!.linkedLocationNeedQty).toBe(0)
    expect(layered.finalQty).toBe(0)
  })

  it('(d) 이력 30일 옵션 → MANUAL, siblingAvgRate = 형제 선택 모델 일률 평균, 수량 = 수동값', () => {
    const rs = computeProductPlan({
      options: [
        opt({ optionId: 'old1' }),
        opt({ optionId: 'old2', qtyByDate: qtyByDate(90, () => 4) }),
        opt({ optionId: 'new', qtyByDate: qtyByDate(30, () => 9), historyDays: 30 }),
      ],
      product: { ...product, overrideModel: 'MA30' },
      manualQtyByOption: { new: 15 },
      now: NOW,
    })
    const n = rs.find((r) => r.optionId === 'new')!
    expect(n.isNewOption).toBe(true)
    expect(n.selectedModel).toBe('MANUAL')
    expect(n.siblingAvgRate).toBeCloseTo(3)
    expect(n.finalQty).toBe(15)
    expect(n.modelForecasts.selected).toBe('MANUAL')
    const o = rs.find((r) => r.optionId === 'old1')!
    expect(o.isNewOption).toBe(false)
    expect(o.selectedModel).toBe('MA30')
  })

  it('(d-2) 수동값 없으면 0, 형제 없으면 siblingAvgRate null', () => {
    const [n] = computeProductPlan({
      options: [opt({ optionId: 'new', historyDays: 10 })],
      product,
      now: NOW,
    })
    expect(n.selectedModel).toBe('MANUAL')
    expect(n.finalQty).toBe(0)
    expect(n.siblingAvgRate).toBeNull()
  })

  it('(e) overrideModel MA90 지정 시 그 일률 사용, 미지정이면 configModel', () => {
    // 앞 60일 1개/일, 최근 30일 3개/일 → MA30=3, MA90=150/90
    const series = qtyByDate(90, (i) => (i < 60 ? 1 : 3))
    const base = { options: [opt({ optionId: 'a', qtyByDate: series })], now: NOW }
    const [ma90] = computeProductPlan({ ...base, product: { ...product, overrideModel: 'MA90' } })
    expect(ma90.selectedModel).toBe('MA90')
    expect(ma90.dailyRate).toBeCloseTo(150 / 90)
    expect(ma90.models.MA30.dailyRate).toBeCloseTo(3)
    expect(ma90.suggestedQty).toBe(Math.ceil((150 / 90) * 50))
    expect(ma90.models.MA90.qty).toBe(ma90.suggestedQty)

    const [cfg] = computeProductPlan({ ...base, product: { ...product, configModel: 'MA30' } })
    expect(cfg.selectedModel).toBe('MA30')
    expect(cfg.suggestedQty).toBe(150)
  })

  it('지정 없으면 추천 모델 선택 + backtestWape 상품 공통', () => {
    const rs = computeProductPlan({
      options: [opt({ optionId: 'a' }), opt({ optionId: 'b' })],
      product,
      now: NOW,
    })
    expect(rs[0].selectedModel).toBe(rs[0].recommendedModel)
    expect(rs[0].backtestWape).toEqual(rs[1].backtestWape)
    expect(rs[0].backtestWape.MA30).toBeCloseTo(0)
  })

  it('bias 는 일률에 곱해 수량에 반영 (modelForecasts.rates 는 원본)', () => {
    const [r] = computeProductPlan({
      options: [opt({ optionId: 'a', biasFactor: 1.5 })],
      product: { ...product, overrideModel: 'MA30' },
      now: NOW,
    })
    expect(r.suggestedQty).toBe(150)
    expect(r.modelForecasts.rates.MA30).toBeCloseTo(2)
  })
})
