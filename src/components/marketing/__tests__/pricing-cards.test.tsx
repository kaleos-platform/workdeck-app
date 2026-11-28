import { renderToStaticMarkup } from 'react-dom/server'
import { PricingCards } from '../pricing/pricing-cards'
import { DECK_PRICING_ROWS } from '@/lib/marketing/pricing-data'
import { DECK_LANDINGS } from '@/lib/marketing/decks'

const html = (ids: string[]) =>
  renderToStaticMarkup(<PricingCards rows={DECK_PRICING_ROWS} releasedIds={ids} />)

describe('요금제 카드', () => {
  it('판매 중 카드가 준비중보다 앞이고 포함 기능·CTA가 맞다', () => {
    const out = html(['recruiting'])
    expect(out.indexOf('판매 중')).toBeLessThan(out.indexOf('준비 중인 업무'))
    expect(out.match(/lucide-circle-check/g)).toHaveLength(DECK_LANDINGS.recruiting.features.length)
    expect(out).toMatch(/href="[^"]*\/recruiting#lead-form"/)
    expect(out).not.toContain('href="/recruiting#apply"')
    expect(out).toContain('href="/finance#apply"')
  })

  it('폼 없는 업무가 판매 중이면 모집 관리 폼으로 보내고 #apply가 없다', () => {
    expect(DECK_LANDINGS.finance.leadForm).toBeUndefined()
    const out = html(['recruiting', 'finance'])
    expect(out).not.toContain('href="/finance#apply"')
    expect(out).not.toContain('finance#lead-form')
    expect(out.match(/href="[^"]*\/recruiting#lead-form"/g)).toHaveLength(2)
  })

  it('판매 중 업무가 없으면 결제 조건·VAT 안내를 숨긴다', () => {
    const out = html([])
    expect(out).not.toContain('자동결제')
    expect(out).not.toContain('VAT')
    expect(out).toContain('준비 중인 업무')
  })
})
