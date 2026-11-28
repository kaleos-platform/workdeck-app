import { DECK_LANDINGS } from '../decks'
import {
  DECK_PRICING_ROWS,
  PRICE_TOKEN,
  resolveLandingPrice,
  withLivePrices,
} from '../pricing-data'

describe('withLivePrices', () => {
  it('DB 공급가로 공급가·VAT 포함가를 다시 계산한다', () => {
    const rows = withLivePrices(DECK_PRICING_ROWS, { recruiting: 30000 })
    const recruiting = rows.find((r) => r.slug === 'recruiting')!
    expect(recruiting.supplyPrice).toBe(30000)
    expect(recruiting.totalPrice).toBe(33000)
  })

  it('DB 값이 없는 업무는 기본값 유지', () => {
    const rows = withLivePrices(DECK_PRICING_ROWS, {})
    expect(rows).toEqual(DECK_PRICING_ROWS)
  })
})

function priceTexts(c: ReturnType<typeof resolveLandingPrice>) {
  return [c.hero.note ?? '', ...c.faq.map((f) => f.answer), ...(c.migration?.points ?? [])]
}

describe('resolveLandingPrice', () => {
  const landings = Object.values(DECK_LANDINGS)

  it('모든 업무 × (가격 / null) 결과에 자리표시자가 남지 않는다', () => {
    for (const landing of landings) {
      for (const price of [33000, null]) {
        for (const text of priceTexts(resolveLandingPrice(landing, price))) {
          expect(text).not.toContain(PRICE_TOKEN)
        }
      }
    }
  })

  it('recruiting: 위치별로 가격을 채우고 13,500원 보장가는 유지한다', () => {
    const r = resolveLandingPrice(DECK_LANDINGS.recruiting, 33000)
    expect(r.hero.note).toBe('7일 무료 체험 · 이후 월 33,000원(부가세 포함)')
    expect(
      r.migration!.points.some((p) => p.includes('정가 33,000원') && p.includes('13,500원'))
    ).toBe(true)
    expect(r.faq.find((f) => f.question === '이용 비용은 얼마인가요?')!.answer).toContain(
      '33,000원'
    )
  })

  it('가격이 null이면 가격 FAQ·이전 안내 문구를 빼고 note는 비운다', () => {
    for (const landing of landings) {
      const priced = landing.faq.filter((f) => f.answer.includes(PRICE_TOKEN)).length
      const r = resolveLandingPrice(landing, null)
      expect(r.faq).toHaveLength(landing.faq.length - priced)
      expect(r.hero.note).toBeUndefined()
    }
  })

  it('deck 데이터의 고정 금액은 13,500원뿐이다', () => {
    for (const landing of landings) {
      for (const text of priceTexts(landing)) {
        for (const m of text.match(/[0-9]+,[0-9]{3}원/g) ?? []) expect(m).toBe('13,500원')
      }
    }
  })

  it('원본을 바꾸지 않는다', () => {
    const before = JSON.stringify(DECK_LANDINGS)
    for (const landing of landings) {
      resolveLandingPrice(landing, 33000)
      resolveLandingPrice(landing, null)
    }
    expect(JSON.stringify(DECK_LANDINGS)).toBe(before)
  })
})
