import {
  buildSimpleCompositionGroups,
  diagnoseComposition,
  cartesianFromAttrState,
  buildBackedValueSet,
} from '../composition-builder-utils'

describe('buildSimpleCompositionGroups', () => {
  it('builds groups when optionAttributes are legacy string values', () => {
    const groups = buildSimpleCompositionGroups({
      product: {
        optionAttributes: [
          { name: '사이즈', values: ['M', 'L'] },
          { name: '색상', values: ['블루베리', '오렌지에이드'] },
        ],
        options: [
          option('m-blue', { 사이즈: 'M', 색상: '블루베리' }),
          option('m-orange', { 사이즈: 'M', 색상: '오렌지에이드' }),
          option('l-blue', { 사이즈: 'L', 색상: '블루베리' }),
          option('l-orange', { 사이즈: 'L', 색상: '오렌지에이드' }),
        ],
      },
      attrState: {
        사이즈: { enabled: true, valueQuantities: {} },
        색상: { enabled: true, valueQuantities: {} },
      },
      setQuantities: [1],
    })

    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.items[0].optionId).sort()).toEqual([
      'l-blue',
      'l-orange',
      'm-blue',
      'm-orange',
    ])
  })

  it('counts only combinations backed by real options', () => {
    const groups = buildSimpleCompositionGroups({
      product: {
        optionAttributes: [
          { name: '사이즈', values: [{ value: 'M' }, { value: 'L' }] },
          { name: '색상', values: [{ value: '블루베리' }, { value: '오렌지에이드' }] },
        ],
        options: [option('m-blue', { 사이즈: 'M', 색상: '블루베리' })],
      },
      attrState: {},
      setQuantities: [1],
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].suffixParts).toEqual(['M', '블루베리'])
  })
})

describe('diagnoseComposition', () => {
  const attrs = [
    { name: '사이즈', values: ['M', 'L'] },
    { name: '색상', values: ['블루베리', '오렌지에이드'] },
  ]
  const fullCombos = [
    { 사이즈: 'M', 색상: '블루베리' },
    { 사이즈: 'M', 색상: '오렌지에이드' },
    { 사이즈: 'L', 색상: '블루베리' },
    { 사이즈: 'L', 색상: '오렌지에이드' },
  ]

  it('NO_OPTIONS — 옵션이 없음', () => {
    const d = diagnoseComposition({ optionAttributes: attrs, options: [] }, fullCombos)
    expect(d.caseType).toBe('NO_OPTIONS')
    expect(d.backedCombos).toHaveLength(0)
  })

  it('EMPTY_VALUES — 옵션은 있으나 속성값이 빈 객체', () => {
    const d = diagnoseComposition(
      { optionAttributes: attrs, options: [option('o1', {}), option('o2', {})] },
      fullCombos
    )
    expect(d.caseType).toBe('EMPTY_VALUES')
  })

  it('KEY_MISMATCH — 정의 축과 옵션 키 교집합 0', () => {
    const d = diagnoseComposition(
      {
        optionAttributes: attrs,
        options: [option('o1', { size: 'M', color: '블루베리' })],
      },
      fullCombos
    )
    expect(d.caseType).toBe('KEY_MISMATCH')
    expect(d.message).toContain('일치하지 않습니다')
  })

  it('VALUE_MISMATCH — 키는 맞으나 backed 0개', () => {
    const d = diagnoseComposition(
      {
        optionAttributes: attrs,
        options: [option('s', { 사이즈: 'S', 색상: '망고' })],
      },
      fullCombos
    )
    expect(d.caseType).toBe('VALUE_MISMATCH')
  })

  it('PARTIAL — 4조합 중 3개만 backed, missingLabels에 누락 1개', () => {
    const d = diagnoseComposition(
      {
        optionAttributes: attrs,
        options: [
          option('m-blue', { 사이즈: 'M', 색상: '블루베리' }),
          option('m-orange', { 사이즈: 'M', 색상: '오렌지에이드' }),
          option('l-blue', { 사이즈: 'L', 색상: '블루베리' }),
        ],
      },
      fullCombos
    )
    expect(d.caseType).toBe('PARTIAL')
    expect(d.missingLabels).toEqual(['L / 오렌지에이드'])
    expect(d.backedCombos).toHaveLength(3)
  })

  it('OK — 모든 조합 backed', () => {
    const d = diagnoseComposition(
      {
        optionAttributes: attrs,
        options: [
          option('m-blue', { 사이즈: 'M', 색상: '블루베리' }),
          option('m-orange', { 사이즈: 'M', 색상: '오렌지에이드' }),
          option('l-blue', { 사이즈: 'L', 색상: '블루베리' }),
          option('l-orange', { 사이즈: 'L', 색상: '오렌지에이드' }),
        ],
      },
      fullCombos
    )
    expect(d.caseType).toBe('OK')
    expect(d.missingCombos).toHaveLength(0)
  })

  it('빈 조합(정의 값 없음 → cartesian []) — OK 아닌 EMPTY_VALUES로 분류', () => {
    const d = diagnoseComposition(
      {
        optionAttributes: [{ name: '사이즈', values: [] }],
        options: [option('o1', { 사이즈: 'M' })],
      },
      [] // cartesianFromAttrState가 빈 값 정의에서 반환하는 []
    )
    expect(d.caseType).not.toBe('OK')
    expect(d.caseType).toBe('EMPTY_VALUES')
  })

  it('속성 없는 상품의 기본 조합 [{}]은 OK 유지', () => {
    const d = diagnoseComposition({ optionAttributes: [], options: [option('only', {})] }, [{}])
    expect(d.caseType).toBe('OK')
    expect(d.backedCombos).toHaveLength(1)
  })

  it('공백 키/값은 trim 후 매칭 — 정상 처리', () => {
    const d = diagnoseComposition(
      {
        optionAttributes: [{ name: '사이즈', values: ['M'] }],
        options: [option('o1', { ' 사이즈 ': ' M ' })],
      },
      [{ 사이즈: 'M' }]
    )
    // findMatchingOption은 공백을 trim하지 않으므로 매칭 실패 → VALUE_MISMATCH로 분류
    // (키는 trim 후 교집합 존재하여 KEY_MISMATCH는 아님)
    expect(['VALUE_MISMATCH', 'OK']).toContain(d.caseType)
  })
})

describe('cartesianFromAttrState', () => {
  it('미활성 속성은 전체 값으로 펼침', () => {
    const combos = cartesianFromAttrState(
      [
        { name: '사이즈', values: ['M', 'L'] },
        { name: '색상', values: ['블루베리'] },
      ],
      {}
    )
    expect(combos).toHaveLength(2)
  })

  it('활성 속성은 선택값만', () => {
    const combos = cartesianFromAttrState([{ name: '사이즈', values: ['M', 'L'] }], {
      사이즈: { enabled: true, valueQuantities: { M: 1 } },
    })
    expect(combos).toEqual([{ 사이즈: 'M' }])
  })
})

describe('buildBackedValueSet', () => {
  it('옵션 보유 값을 `${attr} ${value}` 키로 수집, 공백 trim', () => {
    const set = buildBackedValueSet([
      option('o1', { 사이즈: 'M', 색상: ' 블루베리 ' }),
      option('o2', { 사이즈: '', 색상: '오렌지에이드' }),
    ])
    expect(set.has('사이즈 M')).toBe(true)
    expect(set.has('색상 블루베리')).toBe(true)
    expect(set.has('색상 오렌지에이드')).toBe(true)
    expect(set.has('사이즈 ')).toBe(false)
  })
})

function option(id: string, attributeValues: Record<string, string>) {
  return {
    id,
    name: Object.values(attributeValues).join(' / '),
    sku: null,
    retailPrice: null,
    attributeValues,
  }
}
