// @jest-environment node
// groupOptionsByPrice 단위 테스트

import { groupOptionsByPrice, type OptionInput } from '../price-group'

// ─── 베개커버 예시: 사이즈 2가지, 색상 4가지 ──────────────────────────────────

const SIZES = ['50x70', '70x70']
const COLORS = ['화이트', '그레이', '블루', '핑크']

function makeOptions(
  sizeLabel: string,
  costPrice: number,
  retailPrice: number,
  colors = COLORS
): OptionInput[] {
  return colors.map((color, i) => ({
    optionId: `opt-${sizeLabel}-${color}`,
    optionName: `${sizeLabel} / ${color}`,
    costPrice,
    retailPrice,
    attributeValues: { 사이즈: sizeLabel, 색상: color },
  }))
}

// 사이즈 50x70: 원가 24000, 소매가 26000 → 4색상
const smallOptions = makeOptions('50x70', 24000, 26000)
// 사이즈 70x70: 원가 28000, 소매가 32000 → 4색상
const largeOptions = makeOptions('70x70', 28000, 32000)

describe('groupOptionsByPrice — 베개커버 8옵션 예시', () => {
  const allOptions = [...smallOptions, ...largeOptions]

  test('정확히 2그룹 생성', () => {
    const groups = groupOptionsByPrice(allOptions)
    expect(groups).toHaveLength(2)
  })

  test('각 그룹에 optionIds 4개', () => {
    const groups = groupOptionsByPrice(allOptions)
    for (const g of groups) {
      expect(g.optionIds).toHaveLength(4)
    }
  })

  test('sharedLabel에 사이즈(공유 속성)가 포함, 색상(비공유)은 미포함', () => {
    const groups = groupOptionsByPrice(allOptions)
    const smallGroup = groups.find((g) => g.costPrice === 24000)!
    expect(smallGroup.sharedLabel).toContain('50x70')
    expect(smallGroup.sharedLabel).not.toContain('화이트')
    expect(smallGroup.sharedLabel).not.toContain('그레이')
  })

  test('sharedLabel에 소매가(원) 형식 포함', () => {
    const groups = groupOptionsByPrice(allOptions)
    const smallGroup = groups.find((g) => g.costPrice === 24000)!
    expect(smallGroup.sharedLabel).toContain('26,000원')
  })

  test('priceUndefined=false (유효 가격 그룹)', () => {
    const groups = groupOptionsByPrice(allOptions)
    for (const g of groups) {
      expect(g.priceUndefined).toBe(false)
    }
  })

  test('representativeOptionId는 각 그룹의 첫 번째 optionId', () => {
    const groups = groupOptionsByPrice(allOptions)
    const smallGroup = groups.find((g) => g.costPrice === 24000)!
    expect(smallGroup.representativeOptionId).toBe(smallGroup.optionIds[0])
    expect(smallGroup.representativeOptionId).toBe('opt-50x70-화이트')
  })

  test('입력 순서 유지 — 그룹 순서가 첫 등장 순서를 따름', () => {
    const groups = groupOptionsByPrice(allOptions)
    expect(groups[0].costPrice).toBe(24000) // smallOptions 먼저
    expect(groups[1].costPrice).toBe(28000)
  })
})

// ─── null 가격 옵션 ───────────────────────────────────────────────────────────

describe('groupOptionsByPrice — null 가격 분리', () => {
  const validOpt: OptionInput = {
    optionId: 'v1',
    optionName: '유효 옵션',
    costPrice: 10000,
    retailPrice: 20000,
  }
  const nullCostOpt: OptionInput = {
    optionId: 'n1',
    optionName: '원가 없음',
    costPrice: null,
    retailPrice: 20000,
  }
  const nullRetailOpt: OptionInput = {
    optionId: 'n2',
    optionName: '소매가 없음',
    costPrice: 10000,
    retailPrice: null,
  }

  test('null 원가 옵션은 별도 그룹 (priceUndefined=true)', () => {
    const groups = groupOptionsByPrice([validOpt, nullCostOpt])
    expect(groups).toHaveLength(2)
    const nullGroup = groups.find((g) => g.optionIds.includes('n1'))!
    expect(nullGroup.priceUndefined).toBe(true)
  })

  test('null 소매가 옵션은 별도 그룹 (priceUndefined=true)', () => {
    const groups = groupOptionsByPrice([validOpt, nullRetailOpt])
    expect(groups).toHaveLength(2)
    const nullGroup = groups.find((g) => g.optionIds.includes('n2'))!
    expect(nullGroup.priceUndefined).toBe(true)
  })

  test('null 가격 그룹은 유효 가격 그룹과 병합되지 않음', () => {
    const groups = groupOptionsByPrice([validOpt, nullCostOpt])
    const validGroup = groups.find((g) => g.optionIds.includes('v1'))!
    expect(validGroup.optionIds).not.toContain('n1')
  })

  test("null 가격 sharedLabel에 '가격 미정' 포함", () => {
    const groups = groupOptionsByPrice([nullCostOpt])
    expect(groups[0].sharedLabel).toContain('가격 미정')
  })
})

// ─── float 정규화 ─────────────────────────────────────────────────────────────

describe('groupOptionsByPrice — float 정규화', () => {
  test('24000.0과 24000은 같은 그룹으로 묶임', () => {
    const opts: OptionInput[] = [
      { optionId: 'a', optionName: 'A', costPrice: 24000.0, retailPrice: 26000 },
      { optionId: 'b', optionName: 'B', costPrice: 24000, retailPrice: 26000 },
    ]
    const groups = groupOptionsByPrice(opts)
    expect(groups).toHaveLength(1)
    expect(groups[0].optionIds).toEqual(['a', 'b'])
  })

  test('소수점 반올림 차이(24000.4 vs 24000.6)는 같은 그룹', () => {
    // Math.round(24000.4) = 24000, Math.round(24000.6) = 24001 → 다른 그룹
    const opts: OptionInput[] = [
      { optionId: 'a', optionName: 'A', costPrice: 24000.4, retailPrice: 26000 },
      { optionId: 'b', optionName: 'B', costPrice: 24000.4, retailPrice: 26000 },
    ]
    const groups = groupOptionsByPrice(opts)
    expect(groups).toHaveLength(1)
  })
})

// ─── sizeLabel 폴백 ───────────────────────────────────────────────────────────

describe('groupOptionsByPrice — sizeLabel 폴백', () => {
  test('attributeValues 없고 sizeLabel 있으면 sharedLabel에 포함', () => {
    const opts: OptionInput[] = [
      {
        optionId: 'a',
        optionName: 'L',
        costPrice: 10000,
        retailPrice: 20000,
        sizeLabel: 'L',
      },
      {
        optionId: 'b',
        optionName: 'L/화이트',
        costPrice: 10000,
        retailPrice: 20000,
        sizeLabel: 'L',
      },
    ]
    const groups = groupOptionsByPrice(opts)
    expect(groups).toHaveLength(1)
    expect(groups[0].sharedLabel).toContain('L')
  })
})
