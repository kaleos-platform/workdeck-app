import {
  despaceKeyword,
  keywordKeys,
  normalizeKeyword,
  sortedTokenKey,
  splitTokens,
} from '../keyword-normalize'

describe('normalizeKeyword', () => {
  it('소문자 + 연속 공백 축약 + trim', () => {
    expect(normalizeKeyword('  호텔   TAWOL  ')).toBe('호텔 tawol')
  })
})

describe('despaceKeyword — §11 띄어쓰기 변형', () => {
  it('"호텔타월"과 "호텔 타월"이 같은 키가 된다', () => {
    expect(despaceKeyword('호텔 타월')).toBe(despaceKeyword('호텔타월'))
  })

  it('normalized 로는 서로 다르다 (그래서 별도 키가 필요하다)', () => {
    expect(normalizeKeyword('호텔 타월')).not.toBe(normalizeKeyword('호텔타월'))
  })

  it('하이픈·슬래시·괄호도 제거한다', () => {
    expect(despaceKeyword('세면-수건/대형(3매)')).toBe('세면수건대형3매')
  })
})

describe('sortedTokenKey — §12 단어 순서 순열', () => {
  it('"여성 속옷"과 "속옷 여성"이 같은 키가 된다', () => {
    expect(sortedTokenKey('여성 속옷')).toBe(sortedTokenKey('속옷 여성'))
  })

  it('단어가 다르면 다른 키다', () => {
    expect(sortedTokenKey('여성 속옷')).not.toBe(sortedTokenKey('여성 모달 속옷'))
  })

  it('중복 토큰을 제거하지 않는다', () => {
    expect(sortedTokenKey('여성 여성 속옷')).not.toBe(sortedTokenKey('여성 속옷'))
  })
})

describe('splitTokens', () => {
  it('중복을 제거하지 않는다 (§8.1 반복 탐지의 전제)', () => {
    expect(splitTokens('여성 팬티 모달 팬티')).toEqual(['여성', '팬티', '모달', '팬티'])
  })

  it('빈 문자열은 빈 배열', () => {
    expect(splitTokens('   ')).toEqual([])
  })
})

describe('keywordKeys', () => {
  it('3개 키를 한 번에 만든다', () => {
    expect(keywordKeys('호텔 타월')).toEqual({
      normalized: '호텔 타월',
      despaced: '호텔타월',
      sortedKey: '타월 호텔',
    })
  })
})
