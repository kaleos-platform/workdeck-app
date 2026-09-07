import {
  coverByNameTokens,
  despaceKeyword,
  keywordKeys,
  normalizeKeyword,
  sortedTokenKey,
  splitTokens,
  stripNameTokens,
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

describe('coverByNameTokens — §10 한국어 복합어 분해', () => {
  // prod 실제 사례. 상품명 어순이 `커버 브라 노와이어` 라 despaced 부분문자열로는 안 잡힌다.
  const nameTokens = [
    '에이엠엘',
    '쿨',
    '메쉬',
    '심리스',
    '커버',
    '브라',
    '노와이어',
    '후크없이',
    '편안한',
    '중년',
    '여성',
    '속옷',
  ]

  it('상품명 단어만으로 이뤄진 검색어를 쪼갠다', () => {
    expect(coverByNameTokens('노와이어브라', nameTokens)?.pieces).toEqual(['노와이어', '브라'])
    expect(coverByNameTokens('심리스브라', nameTokens)?.pieces).toEqual(['심리스', '브라'])
    expect(coverByNameTokens('중년여성브라', nameTokens)?.pieces).toEqual(['중년', '여성', '브라'])
  })

  it('상품명에 없는 단어가 하나라도 섞이면 null', () => {
    expect(coverByNameTokens('티셔츠브라', nameTokens)).toBeNull()
    expect(coverByNameTokens('여름브라', nameTokens)).toBeNull()
    expect(coverByNameTokens('갱년기여성속옷', nameTokens)).toBeNull()
    expect(coverByNameTokens('브라탑', nameTokens)).toBeNull() // '탑' 이 상품명에 없다
  })

  it('greedy(최장일치)였다면 실패하는 케이스를 DP 는 덮는다', () => {
    // 최장일치는 '아이' 를 먹고 '스' 에서 막힌다. 실제 분해는 '아 + 이스'.
    expect(coverByNameTokens('아이스', ['아', '아이', '이스'])?.pieces).toEqual(['아', '이스'])
  })

  it('접두사 관계 토큰이 공존해도 분해한다', () => {
    expect(coverByNameTokens('여성브라탑', ['브라', '브라탑', '여성'])?.pieces).toEqual([
      '여성',
      '브라탑',
    ])
  })

  it('분해가 여러 개면 조각 수가 가장 적은 것을 고른다', () => {
    // '가나다' 는 [가,나,다] 3조각으로도 [가나,다] 2조각으로도 덮인다.
    expect(coverByNameTokens('가나다', ['가', '나', '다', '가나'])?.pieces).toEqual(['가나', '다'])
  })

  it('조각 1개(상품명 토큰과 완전히 같음)도 분해로는 성공한다 — 호출부가 2개 이상을 요구한다', () => {
    expect(coverByNameTokens('브라', nameTokens)?.pieces).toEqual(['브라'])
  })

  it('1글자 토큰도 분해 단위로 인정한다 (길이 하한 없음 — 의도)', () => {
    expect(coverByNameTokens('쿨브라', nameTokens)?.pieces).toEqual(['쿨', '브라'])
  })

  it('띄어쓰기·구분자는 무시하고 비교한다', () => {
    expect(coverByNameTokens('노와이어 브라', nameTokens)?.pieces).toEqual(['노와이어', '브라'])
    expect(coverByNameTokens('노와이어-브라', nameTokens)?.pieces).toEqual(['노와이어', '브라'])
  })

  it('빈 검색어·빈 사전·64자 초과는 null', () => {
    expect(coverByNameTokens('', nameTokens)).toBeNull()
    expect(coverByNameTokens('   ', nameTokens)).toBeNull()
    expect(coverByNameTokens('브라', [])).toBeNull()
    expect(coverByNameTokens('브라'.repeat(40), nameTokens)).toBeNull()
  })

  it('원문 표기를 보존해 돌려준다', () => {
    expect(coverByNameTokens('COOLBRA', ['Cool', 'Bra'])?.pieces).toEqual(['Cool', 'Bra'])
  })
})

describe('stripNameTokens — 상품명 단어를 걷어낸 나머지', () => {
  const nameTokens = [
    '에이엠엘',
    '쿨',
    '메쉬',
    '심리스',
    '커버',
    '브라',
    '노와이어',
    '후크없이',
    '편안한',
    '중년',
    '여성',
    '속옷',
  ]
  const strip = (kw: string) => stripNameTokens(kw, nameTokens)?.stripped

  it('사용자 제보 사례를 그대로 재현한다', () => {
    expect(strip('군살보정브라')).toBe('군살보정')
    expect(strip('노후크브라')).toBe('노후크') // 상품명은 '후크없이' 라 '후크' 는 안 지워진다
    expect(strip('매쉬브라')).toBe('매쉬') // '메쉬' 와 글자가 달라 안 지워진다
    expect(strip('아이스브라')).toBe('아이스')
    expect(strip('엄마브라')).toBe('엄마')
    expect(strip('여름브라')).toBe('여름')
    expect(strip('풀컵브라')).toBe('풀컵')
    expect(strip('운동용브라')).toBe('운동용')
    expect(strip('갱년기브라')).toBe('갱년기')
  })

  it('상품명 단어가 여러 개면 모두 걷어낸다', () => {
    expect(strip('50대여성브라')).toBe('50대') // 여성·브라 둘 다 상품명 단어
    expect(strip('중년여성브라')).toBe('')
  })

  it('전부 걷히면 빈 문자열', () => {
    expect(strip('노와이어브라')).toBe('')
    expect(strip('심리스브라')).toBe('')
    expect(strip('브라')).toBe('')
  })

  it('띄어쓰기를 보존한다 (토큰 단위로 먼저 처리한다)', () => {
    expect(strip('통기성 좋은 브라')).toBe('통기성 좋은')
  })

  it('상품명 단어가 없으면 null', () => {
    expect(stripNameTokens('레이스', nameTokens)).toBeNull()
    expect(stripNameTokens('편한브래지어', nameTokens)).toBeNull()
  })

  it('걷어낸 단어를 원문 표기로 돌려준다', () => {
    expect(stripNameTokens('여름브라', nameTokens)?.removed).toEqual(['브라'])
    expect(stripNameTokens('50대여성브라', nameTokens)?.removed.sort()).toEqual(
      ['브라', '여성'].sort()
    )
  })

  it('긴 상품명 단어를 먼저 지운다 (브라 / 브라탑 공존)', () => {
    expect(stripNameTokens('여성브라탑', ['브라', '브라탑', '여성'])?.stripped).toBe('')
  })

  it('같은 단어가 두 번 들어가도 전부 지운다', () => {
    expect(strip('브라브라캡')).toBe('캡')
  })

  it('빈 입력·빈 사전은 null', () => {
    expect(stripNameTokens('', nameTokens)).toBeNull()
    expect(stripNameTokens('여름브라', [])).toBeNull()
  })
})

describe('stripNameTokens — 예외 단어(분해 금지)', () => {
  const nameTokens = ['쿨', '메쉬', '심리스', '편한', '브라', '노와이어', '스포츠']

  it("'쿨링' 은 '쿨' 로 잘리지 않는다 (지울 것이 없어 null)", () => {
    expect(stripNameTokens('쿨링', nameTokens)?.stripped).toBe('링')
    expect(stripNameTokens('쿨링', nameTokens, ['쿨링'])).toBeNull()
  })

  it('예외 단어 밖의 상품명 단어는 그대로 걷어낸다', () => {
    const r = stripNameTokens('쿨링브라', nameTokens, ['쿨링'])
    expect(r?.stripped).toBe('쿨링')
    expect(r?.removed).toEqual(['브라'])
  })

  it('예외 단어를 통째로 포함하는 상품명 단어는 여전히 지운다 (superset)', () => {
    expect(stripNameTokens('노와이어브라', nameTokens, ['와이'])?.stripped).toBe('')
  })

  it('한 글자 예외 항목은 무시한다 (자를 수 없으므로 의미가 없다)', () => {
    expect(stripNameTokens('쿨링', nameTokens, ['쿨'])?.stripped).toBe('링')
  })

  it('매칭되지 않는 예외 항목은 아무 영향이 없다', () => {
    expect(stripNameTokens('여름브라', nameTokens, ['전혀무관'])?.stripped).toBe('여름')
  })
})
