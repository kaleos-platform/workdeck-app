import { applyKeywordOps, suppressRejected } from '../keyword-review'

describe('suppressRejected', () => {
  it('띄어쓰기 무시로 거절 단어를 빼고 suppressed 에 모은다', () => {
    const r = suppressRejected(
      [{ word: '항균' }, { word: '학생' }, { word: '주니어' }],
      (x) => x.word,
      ['학 생', '기타']
    )
    expect(r.kept.map((x) => x.word)).toEqual(['항균', '주니어'])
    expect(r.suppressed).toEqual(['학생'])
  })
  it('거절 이력 없으면 그대로', () => {
    expect(suppressRejected(['a'], (x) => x, []).kept).toEqual(['a'])
  })
})

describe('applyKeywordOps', () => {
  it('정규화 중복은 추가하지 않고, 삭제는 정규화 비교', () => {
    const r = applyKeywordOps(['Kids Bag', '가방'], ['kids  bag', '항균'], ['가방'])
    expect(r).toEqual({ ok: true, keywords: ['Kids Bag', '항균'] })
  })
  it('한도 초과면 에러(부분 적용 없음)', () => {
    const cur = Array.from({ length: 30 }, (_, i) => `k${i}`)
    const r = applyKeywordOps(cur, ['new'], [])
    expect(r.ok).toBe(false)
  })
  it('삭제로 자리가 나면 한도 안', () => {
    const cur = Array.from({ length: 30 }, (_, i) => `k${i}`)
    expect(applyKeywordOps(cur, ['new'], ['k0']).ok).toBe(true)
  })
})
