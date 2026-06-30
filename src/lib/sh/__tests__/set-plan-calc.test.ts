import {
  decomposeSetsToOptions,
  suggestSetQty,
  computeSetAvailable,
  type SetItem,
} from '@/lib/sh/set-plan-calc'

// 블랙+화이트 2장 세트 (각 1개), 5장 세트 (화이트 3 + 블랙 2)
const BW: SetItem[] = [
  { optionId: 'black', perSet: 1 },
  { optionId: 'white', perSet: 1 },
]
const FIVE: SetItem[] = [
  { optionId: 'white', perSet: 3 },
  { optionId: 'black', perSet: 2 },
]

describe('decomposeSetsToOptions', () => {
  test('세트 수량 × 구성수량으로 옵션 수량을 산출한다', () => {
    const m = decomposeSetsToOptions([{ listingId: 'L1', setQty: 30, items: BW }])
    expect(m.get('black')).toBe(30)
    expect(m.get('white')).toBe(30)
  })

  test('비대칭 구성(화이트3·블랙2)을 정확히 분해한다', () => {
    const m = decomposeSetsToOptions([{ listingId: 'L2', setQty: 10, items: FIVE }])
    expect(m.get('white')).toBe(30)
    expect(m.get('black')).toBe(20)
  })

  test('공유 옵션은 여러 세트에 걸쳐 Σ 합산된다', () => {
    const m = decomposeSetsToOptions([
      { listingId: 'L1', setQty: 30, items: BW }, // black 30, white 30
      { listingId: 'L2', setQty: 10, items: FIVE }, // white 30, black 20
    ])
    expect(m.get('black')).toBe(50)
    expect(m.get('white')).toBe(60)
  })

  test('0 이하 세트 수량은 무시한다', () => {
    const m = decomposeSetsToOptions([
      { listingId: 'L1', setQty: 0, items: BW },
      { listingId: 'L2', setQty: -5, items: BW },
    ])
    expect(m.size).toBe(0)
  })
})

describe('suggestSetQty (병목)', () => {
  test('가장 모자란 구성요소를 채우는 세트 수를 제안한다', () => {
    // black 50, white 30 필요 → 2장세트(각1) → max(ceil(50/1), ceil(30/1)) = 50
    const need = new Map([
      ['black', 50],
      ['white', 30],
    ])
    expect(suggestSetQty(BW, need)).toBe(50)
  })

  test('비대칭 구성에서 perSet로 나눠 병목을 잡는다', () => {
    // white 30, black 10 필요 → 5장세트(화3·블2) → max(ceil(30/3), ceil(10/2)) = max(10, 5) = 10
    const need = new Map([
      ['white', 30],
      ['black', 10],
    ])
    expect(suggestSetQty(FIVE, need)).toBe(10)
  })

  test('나눗셈은 올림 처리한다', () => {
    const need = new Map([['white', 31]]) // ceil(31/3) = 11
    expect(suggestSetQty(FIVE, need)).toBe(11)
  })

  test('모든 구성옵션 발주량이 0 이하면 0', () => {
    const need = new Map([
      ['black', 0],
      ['white', -3],
    ])
    expect(suggestSetQty(BW, need)).toBe(0)
  })
})

describe('computeSetAvailable', () => {
  test('구성요소 재고의 병목으로 가용 세트 수를 계산한다', () => {
    // black 7, white 5 → 2장세트(각1) → min(7, 5) = 5
    const stock = new Map([
      ['black', 7],
      ['white', 5],
    ])
    expect(computeSetAvailable(BW, stock)).toBe(5)
  })

  test('비대칭 구성에서 floor(재고/perSet)의 최소', () => {
    // white 10(÷3=3), black 9(÷2=4) → min(3, 4) = 3
    const stock = new Map([
      ['white', 10],
      ['black', 9],
    ])
    expect(computeSetAvailable(FIVE, stock)).toBe(3)
  })

  test('재고 누락 옵션은 0으로 간주 → 가용 0', () => {
    const stock = new Map([['black', 10]])
    expect(computeSetAvailable(BW, stock)).toBe(0)
  })
})
