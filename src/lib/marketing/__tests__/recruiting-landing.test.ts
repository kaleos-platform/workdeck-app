import { recruitingLanding } from '../decks/recruiting'

describe('recruiting 랜딩 데이터', () => {
  it('제거된 메시지 템플릿 기능을 언급하지 않는다', () => {
    const text = JSON.stringify(recruitingLanding)
    expect(text).not.toMatch(/메시지 템플릿|템플릿으로 안내|안내 문구는 템플릿/)
  })

  it('결과 안내 링크 기능 카드를 노출한다', () => {
    expect(recruitingLanding.features.some((f) => f.title === '결과 안내 링크')).toBe(true)
  })
})
