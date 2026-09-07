import { diffKeywordChange, keywordsChanged, nameChanged, toKeywordList } from '../keyword-change'

describe('toKeywordList', () => {
  it('배열이 아니면 빈 배열', () => {
    expect(toKeywordList(null)).toEqual([])
    expect(toKeywordList(undefined)).toEqual([])
    expect(toKeywordList('호텔 타월')).toEqual([])
    expect(toKeywordList({ a: 1 })).toEqual([])
  })

  it('문자열이 아닌 원소와 빈 문자열을 걸러내고 공백만 다듬는다', () => {
    expect(toKeywordList([' 호텔타월 ', '', '   ', 3, null, '수건'])).toEqual(['호텔타월', '수건'])
  })
})

describe('keywordsChanged', () => {
  it('순서만 다르면 변경이 아니다', () => {
    expect(keywordsChanged(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('중복만 늘어난 것도 변경이 아니다', () => {
    expect(keywordsChanged(['a', 'b'], ['a', 'b', 'b'])).toBe(false)
  })

  it('원소가 추가·제거·치환되면 변경이다', () => {
    expect(keywordsChanged(['a'], ['a', 'b'])).toBe(true)
    expect(keywordsChanged(['a', 'b'], ['a'])).toBe(true)
    expect(keywordsChanged(['a', 'b'], ['a', 'c'])).toBe(true)
  })

  it('대소문자 차이는 변경으로 본다 — 사용자가 실제로 고친 값이다', () => {
    expect(keywordsChanged(['Towel'], ['towel'])).toBe(true)
  })

  it('Json 컬럼에서 온 비배열 값도 안전하게 다룬다', () => {
    expect(keywordsChanged(null, [])).toBe(false)
    expect(keywordsChanged(null, ['a'])).toBe(true)
  })
})

describe('nameChanged', () => {
  it('앞뒤 공백 차이는 변경이 아니다', () => {
    expect(nameChanged('호텔 타월', ' 호텔 타월 ')).toBe(false)
  })

  it('null 과 빈 문자열은 같다', () => {
    expect(nameChanged(null, '')).toBe(false)
    expect(nameChanged(undefined, null)).toBe(false)
  })

  it('내용이 다르면 변경이다', () => {
    expect(nameChanged('호텔 타월', '호텔타월')).toBe(true)
  })
})

describe('diffKeywordChange', () => {
  it('아무것도 안 바뀌면 changed=false', () => {
    const d = diffKeywordChange({
      beforeName: '수건',
      afterName: '수건',
      beforeKeywords: ['a'],
      afterKeywords: ['a'],
    })
    expect(d).toEqual({
      nameChanged: false,
      keywordsChanged: false,
      changed: false,
      multiChange: false,
    })
  })

  it('상품명만 바뀌면 multiChange=false', () => {
    const d = diffKeywordChange({
      beforeName: '수건',
      afterName: '호텔 수건',
      beforeKeywords: ['a'],
      afterKeywords: ['a'],
    })
    expect(d.changed).toBe(true)
    expect(d.multiChange).toBe(false)
  })

  it('검색어만 바뀌면 multiChange=false', () => {
    const d = diffKeywordChange({
      beforeName: '수건',
      afterName: '수건',
      beforeKeywords: ['a'],
      afterKeywords: ['a', 'b'],
    })
    expect(d.changed).toBe(true)
    expect(d.multiChange).toBe(false)
  })

  it('§26 — 상품명과 검색어를 동시에 바꾸면 multiChange=true', () => {
    const d = diffKeywordChange({
      beforeName: '수건',
      afterName: '호텔 수건',
      beforeKeywords: ['a'],
      afterKeywords: ['b'],
    })
    expect(d.multiChange).toBe(true)
  })
})
