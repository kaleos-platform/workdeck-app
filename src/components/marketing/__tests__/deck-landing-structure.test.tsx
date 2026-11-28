import { renderToStaticMarkup } from 'react-dom/server'
import { DeckLanding } from '../landing/deck-landing'
import { recruitingLanding, recruitingTrustPoints } from '@/lib/marketing/decks/recruiting'
import { DECK_LANDINGS } from '@/lib/marketing/decks'

const recruiting = renderToStaticMarkup(<DeckLanding content={recruitingLanding} released />)

describe('recruiting 랜딩 구조', () => {
  it('신뢰 줄·히어로 이미지·결과 줄이 있다', () => {
    expect(recruiting).toContain('채용 사이트에 공고 링크 붙여넣기')
    expect(recruiting).toContain('언제든 해지')
    expect(recruiting).toContain('applicants.webp')
    expect(recruiting).toContain('→ 템플릿을 골라 내용만 바꾸면 공고 완성')
    expect(recruiting.slice(0, recruiting.indexOf('</section>'))).not.toContain('text-center')
  })

  it('히어로 주 CTA 는 1개(버튼 중첩 없음)이고 로그인은 글자 링크다', () => {
    const hero = recruiting.slice(0, recruiting.indexOf('</section>'))
    expect(hero).not.toContain('<button')
    expect(hero.match(/href="#lead-form"/g)).toHaveLength(1)
    expect(hero).toContain('이미 쓰고 있다면 로그인')
  })

  it('AI 스위치가 꺼지면 AI 신뢰 문구가 빠진다', () => {
    expect(recruitingTrustPoints(true)).toContain('지원자 개인정보는 AI로 보내지 않음')
    expect(recruitingTrustPoints(false)).not.toContain('지원자 개인정보는 AI로 보내지 않음')
    expect(recruitingTrustPoints(false)).toHaveLength(2)
  })
})

describe('준비중 랜딩은 변화 없음', () => {
  it.each(['coupang-ads', 'seller-hub', 'sales-content', 'finance'] as const)(
    '%s: 새 선택 필드를 쓰지 않는다',
    (slug) => {
      const c = DECK_LANDINGS[slug]
      expect(c.hero.image).toBeUndefined()
      expect(c.trustPoints).toBeUndefined()
      expect(c.painPoints?.some((p) => p.result)).toBeFalsy()
    }
  )

  it('finance: 가운데 배치, 신뢰 줄·결과 줄 없음', () => {
    const out = renderToStaticMarkup(
      <DeckLanding content={DECK_LANDINGS.finance} released={false} />
    )
    expect(out).toContain('text-center')
    expect(out).not.toContain('bg-muted/40')
    expect(out).not.toContain('→ ')
  })
})
