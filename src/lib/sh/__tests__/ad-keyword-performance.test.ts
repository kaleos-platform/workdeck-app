import {
  computeAdKeywordPerformance,
  isWordCovered,
  PRUNE_MIN_IMPRESSIONS,
} from '../ad-keyword-performance'

const t = (term: string, imp: number, clk: number, ord: number) => ({
  term,
  imp,
  clk,
  ord,
  cost: 0,
})

describe('isWordCovered', () => {
  it('복합어를 코퍼스 조각으로 덮는다', () => {
    expect(isWordCovered('여성팬티', '여성면티팬티')).toBe(true)
  })
  it('항균 은 향균 만 있으면 덮이지 않는다', () => {
    expect(isWordCovered('항균', '향균팬티')).toBe(false)
  })
  it('선크림 은 썬크림 + 선(한글 1자)으로 덮이지 않는다', () => {
    expect(isWordCovered('선크림', '썬크림선')).toBe(false)
  })
  it('영숫자 1자 조각은 허용한다', () => {
    expect(isWordCovered('a컵', 'a사이즈컵')).toBe(false) // '컵' 은 한글 1자
    expect(isWordCovered('3팩세트', '3개팩세트')).toBe(true)
  })
})

describe('computeAdKeywordPerformance', () => {
  const terms = [
    t('여성 팬티', 1000, 20, 5),
    t('여성팬티 세트', 500, 10, 1),
    t('항균 팬티', 300, 9, 4),
    t('항균 속옷', 200, 5, 4),
    t('무료 배송', 100, 8, 0),
    t('속옷 항균 추천', 50, 0, 0),
  ]
  const r = computeAdKeywordPerformance({
    terms,
    name: '여성 팬티',
    keywords: ['향균', '쿨링'],
  })

  it('등록 키워드 통계는 포함 관계 검색어를 합산한다', () => {
    expect(r.keywordStats['향균']).toEqual({ imp: 0, clk: 0, ord: 0 })
  })
  it('정리 후보는 노출 0 키워드', () => {
    expect(r.prune).toEqual(['향균', '쿨링'])
  })
  it('발굴: 미커버 단어만, 주문 0 제외, 주문 내림차순·클릭 보조', () => {
    expect(r.discover.map((d) => d.word)).toEqual(['항균', '속옷', '세트'])
    expect(r.discover[0]).toMatchObject({ orders: 8, clicks: 14, terms: 2 })
    expect(r.discover[0].examples).toEqual(['항균 팬티', '항균 속옷'])
  })
  it('키워드 통계 포함 관계 (공백 무시)', () => {
    const r2 = computeAdKeywordPerformance({ terms, name: '', keywords: ['여성 팬티'] })
    expect(r2.keywordStats['여성 팬티']).toEqual({ imp: 1500, clk: 30, ord: 6 })
    expect(r2.prune).toEqual([])
  })
  it('총 노출이 PRUNE_MIN_IMPRESSIONS 미만이면 정리 후보를 내지 않는다', () => {
    const low = computeAdKeywordPerformance({
      terms: [t('여성 팬티', PRUNE_MIN_IMPRESSIONS - 1, 3, 1)],
      name: '',
      keywords: ['쿨링'],
    })
    expect(low.prune).toEqual([])
    expect(low.keywordStats['쿨링']).toEqual({ imp: 0, clk: 0, ord: 0 })
    const ok = computeAdKeywordPerformance({
      terms: [t('여성 팬티', PRUNE_MIN_IMPRESSIONS, 3, 1)],
      name: '',
      keywords: ['쿨링'],
    })
    expect(ok.prune).toEqual(['쿨링'])
  })
})
