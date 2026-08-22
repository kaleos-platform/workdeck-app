import {
  applyBaseRename,
  buildSuffix,
  deriveBaseValues,
  joinName,
  type GroupListingForBase,
  type OptionAttribute,
} from '../listing-name-propagation'

// group-detail-view.tsx doSave() / group-base-info-card.tsx 에서 옮겨온 순수함수의
// characterization 테스트. 기대값은 실제 함수를 돌려 나온 결과를 확인 후 고정했다 — 회귀 방지용.

const attrs: OptionAttribute[] = [
  { name: '색상', values: [{ value: '블랙' }, { value: '화이트' }] },
]

function makeListing(over: Partial<GroupListingForBase> = {}): GroupListingForBase {
  return {
    id: 'l1',
    searchName: 'A',
    displayName: 'A',
    managementName: null,
    internalCode: null,
    memo: null,
    items: [{ optionId: 'o1', attributeValues: { 색상: '블랙' } }],
    ...over,
  }
}

describe('joinName', () => {
  it('base와 suffix를 공백으로 잇는다', () => {
    expect(joinName('프리미엄 머드팬티', '블랙')).toBe('프리미엄 머드팬티 블랙')
  })

  it('suffix가 비면 base만 반환한다', () => {
    expect(joinName('프리미엄 머드팬티', '')).toBe('프리미엄 머드팬티')
  })

  it('base가 비면 suffix만 반환한다', () => {
    expect(joinName('', '블랙')).toBe('블랙')
  })
})

describe('buildSuffix', () => {
  it('단일 item의 속성값을 suffix로 사용한다', () => {
    expect(buildSuffix(makeListing(), attrs)).toBe('블랙')
  })

  it('번들 item끼리 속성값이 달라 공통값이 없으면 그 속성을 suffix에서 제외한다', () => {
    const bundle = makeListing({
      items: [
        { optionId: 'o1', attributeValues: { 색상: '블랙' } },
        { optionId: 'o2', attributeValues: { 색상: '화이트' } },
      ],
    })
    expect(buildSuffix(bundle, attrs)).toBe('')
  })

  it('item이 없으면 빈 문자열을 반환한다', () => {
    expect(buildSuffix(makeListing({ items: [] }), attrs)).toBe('')
  })
})

describe('applyBaseRename', () => {
  it('접두어가 정상 매칭되면 tail(공백 포함)을 보존해 새 base로 교체한다', () => {
    const result = applyBaseRename(
      makeListing({ searchName: '프리미엄 머드팬티 블랙', displayName: '프리미엄 머드팬티 블랙' }),
      attrs,
      { baseSearchName: '프리미엄 머드팬티', baseDisplayName: '프리미엄 머드팬티' },
      { searchName: '뉴 머드팬티', displayName: '뉴 머드팬티' }
    )
    expect(result).toEqual({ searchName: '뉴 머드팬티 블랙', displayName: '뉴 머드팬티 블랙' })
  })

  it('접두어가 불일치하면 buildSuffix 폴백으로 attribute suffix를 붙인다', () => {
    const result = applyBaseRename(
      makeListing({ searchName: '완전히 다른 이름', displayName: '완전히 다른 이름' }),
      attrs,
      { baseSearchName: '프리미엄 머드팬티', baseDisplayName: '프리미엄 머드팬티' },
      { searchName: '뉴 머드팬티', displayName: '뉴 머드팬티' }
    )
    expect(result).toEqual({ searchName: '뉴 머드팬티 블랙', displayName: '뉴 머드팬티 블랙' })
  })

  it('listing 이름이 base와 정확히 같으면(tail 빈 문자열) 새 base만 남는다', () => {
    const result = applyBaseRename(
      makeListing({ searchName: '프리미엄 머드팬티', displayName: '프리미엄 머드팬티' }),
      attrs,
      { baseSearchName: '프리미엄 머드팬티', baseDisplayName: '프리미엄 머드팬티' },
      { searchName: '뉴 머드팬티', displayName: '뉴 머드팬티' }
    )
    expect(result).toEqual({ searchName: '뉴 머드팬티', displayName: '뉴 머드팬티' })
  })

  it('번들 item끼리 옵션값이 달라 buildSuffix가 그 속성을 제외하면 tail도 비어 새 base만 남는다', () => {
    const bundle = makeListing({
      searchName: '이상한이름',
      displayName: '이상한이름',
      items: [
        { optionId: 'o1', attributeValues: { 색상: '블랙' } },
        { optionId: 'o2', attributeValues: { 색상: '화이트' } },
      ],
    })
    const result = applyBaseRename(
      bundle,
      attrs,
      { baseSearchName: '프리미엄 머드팬티', baseDisplayName: '프리미엄 머드팬티' },
      { searchName: '뉴 머드팬티', displayName: '뉴 머드팬티' }
    )
    expect(result).toEqual({ searchName: '뉴 머드팬티', displayName: '뉴 머드팬티' })
  })

  it('새 base가 비어있고 tail도 비면(listing 이름 == base) 원래 이름을 유지한다', () => {
    const result = applyBaseRename(
      makeListing({ searchName: '프리미엄 머드팬티', displayName: '프리미엄 머드팬티' }),
      attrs,
      { baseSearchName: '프리미엄 머드팬티', baseDisplayName: '프리미엄 머드팬티' },
      { searchName: '', displayName: '' }
    )
    expect(result).toEqual({ searchName: '프리미엄 머드팬티', displayName: '프리미엄 머드팬티' })
  })

  it('새 base가 비어있어도 tail이 남아있으면 tail만 남긴다(원래 이름 유지가 아니다)', () => {
    // newSearch = ('' + ' 블랙').trim() = '블랙' — truthy이므로 폴백(|| listing.searchName)이 걸리지 않는다.
    const result = applyBaseRename(
      makeListing({ searchName: '프리미엄 머드팬티 블랙', displayName: '프리미엄 머드팬티 블랙' }),
      attrs,
      { baseSearchName: '프리미엄 머드팬티', baseDisplayName: '프리미엄 머드팬티' },
      { searchName: '', displayName: '' }
    )
    expect(result).toEqual({ searchName: '블랙', displayName: '블랙' })
  })
})

describe('deriveBaseValues', () => {
  it('stripSuffix의 `#N ...` 묶음 라벨을 제거하고 base를 복원한다', () => {
    const result = deriveBaseValues(
      [
        makeListing({
          searchName: '프리미엄 머드팬티 블랙 #1 옵션',
          displayName: '프리미엄 머드팬티 블랙 #1 옵션',
        }),
      ],
      attrs
    )
    expect(result.baseSearchName).toBe('프리미엄 머드팬티')
  })

  it('stripSuffix의 ` N개` 차원을 제거하고 base를 복원한다', () => {
    const result = deriveBaseValues(
      [
        makeListing({
          searchName: '프리미엄 머드팬티 블랙 3개',
          displayName: '프리미엄 머드팬티 블랙 3개',
        }),
      ],
      attrs
    )
    expect(result.baseSearchName).toBe('프리미엄 머드팬티')
  })

  it('모든 listing의 displayName이 searchName과 동일하면 baseDisplayName은 빈 문자열이다', () => {
    const result = deriveBaseValues(
      [
        makeListing({
          id: 'l1',
          searchName: '프리미엄 머드팬티 블랙',
          displayName: '프리미엄 머드팬티 블랙',
        }),
        makeListing({
          id: 'l2',
          searchName: '프리미엄 머드팬티 화이트',
          displayName: '프리미엄 머드팬티 화이트',
          items: [{ optionId: 'o2', attributeValues: { 색상: '화이트' } }],
        }),
      ],
      attrs
    )
    expect(result.baseDisplayName).toBe('')
  })

  it('listing마다 base가 달라 대표값을 뽑으면 inconsistentBases가 채워진다', () => {
    const result = deriveBaseValues(
      [
        makeListing({
          id: 'l1',
          searchName: '상품A 블랙',
          displayName: '',
          items: [{ optionId: 'o1', attributeValues: { 색상: '블랙' } }],
        }),
        makeListing({
          id: 'l2',
          searchName: '상품B 화이트',
          displayName: '',
          items: [{ optionId: 'o2', attributeValues: { 색상: '화이트' } }],
        }),
      ],
      attrs
    )
    expect(result.inconsistentBases).toEqual(['검색명'])
    // 대표값(mostCommon)은 count가 동률이면 먼저 나온 값이 유지된다 — '상품A'가 listings[0].
    expect(result.baseSearchName).toBe('상품A')
  })
})
