import { planAbsorb } from '../keyword-absorb'

describe('planAbsorb', () => {
  it('문자열 배열에서 3키를 만든다', () => {
    expect(planAbsorb(['호텔 타월'])).toEqual([
      {
        keyword: '호텔 타월',
        normalized: '호텔 타월',
        despaced: '호텔타월',
        sortedKey: '타월 호텔',
      },
    ])
  })

  it('normalized 기준으로 중복을 접는다 — 첫 원문을 남긴다', () => {
    const out = planAbsorb(['호텔 타월', '호텔  타월', 'ABC', 'abc'])
    expect(out.map((i) => i.keyword)).toEqual(['호텔 타월', 'ABC'])
  })

  it('빈 문자열·공백·비문자열을 버린다', () => {
    expect(planAbsorb(['', '   ', 1, null, undefined, {}, '수건'])).toEqual([
      { keyword: '수건', normalized: '수건', despaced: '수건', sortedKey: '수건' },
    ])
  })

  it('배열이 아니면 빈 배열', () => {
    expect(planAbsorb(null)).toEqual([])
    expect(planAbsorb('수건')).toEqual([])
    expect(planAbsorb({ 0: '수건' })).toEqual([])
  })
})
