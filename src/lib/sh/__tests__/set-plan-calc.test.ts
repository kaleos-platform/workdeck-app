import {
  decomposeSetsToOptions,
  suggestSetQty,
  computeSetAvailable,
  computeLayeredFinalQty,
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

describe('computeLayeredFinalQty (레이어드 단일차감)', () => {
  test('세트분 + 직접분 합산 후 현재고·안전재고 1회 차감', () => {
    // 세트분 30 + 직접분 10 + 안전 5 − 재고 12 = 33
    expect(
      computeLayeredFinalQty({
        rocketContribution: 30,
        directGross: 10,
        safetyStockQty: 5,
        currentStock: 12,
      })
    ).toBe(33)
  })

  test('이중차감 회귀 — 현재고는 합산에 한 번만 차감된다', () => {
    // 합산 GROSS = 70+30 = 100, 안전 0, 재고 60.
    // 단일차감(정답): ceil(100 + 0 − 60) = 40.
    // 만약 레이어별로 60씩 두 번 뺐다면: (70−60)+(30−60) = 10−30 = −20 → max(0)=0.
    // 40 이어야 함(0 이 아니라).
    expect(
      computeLayeredFinalQty({
        rocketContribution: 70,
        directGross: 30,
        safetyStockQty: 0,
        currentStock: 60,
      })
    ).toBe(40)
  })

  test('직접전용 옵션 — 세트 기여 0, 직접분만으로 발주', () => {
    expect(
      computeLayeredFinalQty({
        rocketContribution: 0,
        directGross: 8.2,
        safetyStockQty: 2,
        currentStock: 3,
      })
    ).toBe(8) // ceil(0 + 8.2 + 2 − 3) = ceil(7.2) = 8
  })

  test('재고가 수요를 모두 덮으면 0 (음수 방지)', () => {
    expect(
      computeLayeredFinalQty({
        rocketContribution: 20,
        directGross: 5,
        safetyStockQty: 0,
        currentStock: 100,
      })
    ).toBe(0)
  })

  test('ceil 은 합산 후 1회만 (float 직접분)', () => {
    // ceil(10 + 0.7 + 0 − 0) = ceil(10.7) = 11 (각 항 올림이 아니라 합산 후 올림)
    expect(
      computeLayeredFinalQty({
        rocketContribution: 10,
        directGross: 0.7,
        safetyStockQty: 0,
        currentStock: 0,
      })
    ).toBe(11)
  })
})

// ── 세트 중복 과다집계 회귀 ────────────────────────────────────────────────
// 로켓 옵션 수요는 loadOptionDemand 가 이미 전 세트 판매를 옵션으로 분해·집계한 값이다.
// 한 옵션이 여러 세트 리스팅에 공유될 때, 각 세트를 그 집계 수요 전량을 커버하도록 개별
// suggestSetQty 로 사이징한 뒤 decomposeSetsToOptions 로 합산하면 공유 옵션이 ×N 부풀려진다.
// → 레이어드 최종 옵션수량은 이 분해합산이 아니라 raw 집계 로켓 GROSS 를 로켓 기여로 써야 한다.
describe('세트 중복 과다집계 회귀 (레이어드 옵션=raw 집계, 세트 재-사이징 합산 금지)', () => {
  // 같은 옵션(black/white)을 공유하는 3개 중복 번들 리스팅
  const OVERLAP = [
    { listingId: 'pack2', items: BW }, // white1 black1
    { listingId: 'pack5', items: FIVE }, // white3 black2
    { listingId: 'pack2b', items: BW }, // white1 black1 (또다른 2장 SKU)
  ]
  // 집계 로켓 수요(옵션 단위, 이미 전 세트 판매 분해합산됨)
  const rocketGrossNeed = new Map<string, number>([
    ['white', 100],
    ['black', 100],
  ])

  test('구 방식(세트별 병목 사이징 → 분해합산)은 집계 수요를 ×N 초과한다 (버그 재현)', () => {
    const perListingSetQty = OVERLAP.map((s) => ({
      listingId: s.listingId,
      setQty: suggestSetQty(s.items, rocketGrossNeed),
      items: s.items,
    }))
    const decomposed = decomposeSetsToOptions(perListingSetQty)
    // 각 리스팅이 white/black 100 을 독립 커버 → 분해합산이 집계(100)를 크게 초과
    expect(decomposed.get('white')!).toBeGreaterThan(100)
    expect(decomposed.get('black')!).toBeGreaterThan(100)
  })

  test('신 방식 — 로켓 기여 = raw 집계 GROSS 그대로 (중복 세트 수와 무관)', () => {
    // 옵션 최종 = raw 로켓 집계(100) + 직접(0) + 안전(0) − 재고(40) = 60. 세트 개수·중복과 무관.
    for (const opt of ['white', 'black']) {
      const finalQty = computeLayeredFinalQty({
        rocketContribution: rocketGrossNeed.get(opt)!,
        directGross: 0,
        safetyStockQty: 0,
        currentStock: 40,
      })
      expect(finalQty).toBe(60)
    }
  })

  test('세트 표시값은 옵션 최종수량의 역산(min floor) — 참고용, 되먹임 없음', () => {
    // 옵션 발주 white=60 black=40 → 각 세트가 구성 가능한 완성 세트 수
    const finalByOption = new Map<string, number>([
      ['white', 60],
      ['black', 40],
    ])
    expect(computeSetAvailable(BW, finalByOption)).toBe(40) // min(60/1, 40/1)
    expect(computeSetAvailable(FIVE, finalByOption)).toBe(20) // min(floor(60/3)=20, floor(40/2)=20)
  })
})

// ── 위치 세트 모드 과다집계 회귀 (옵션 중심 통일) ──────────────────────────────
// 실데이터(의식주의 로켓그로스 캡나시-M) 구조: 같은 사이즈 화이트/블랙 옵션이 2장·3장(2종)·5장
// 4개 리스팅에 부분 겹침으로 공유된다. 위치 모드도 각 리스팅을 옵션 net 수요 전량 커버로
// suggestSetQty 사이징 후 decomposeSetsToOptions 합산하면 공유 옵션이 ×N 과다집계된다.
// → 옵션 자체 net 수요를 최종수량으로 쓰고(세트 되먹임 없음) 세트는 읽기전용 역산 표시.
describe('위치 세트 모드 과다집계 회귀 (옵션=자체 수요, 세트 재-사이징 합산 금지)', () => {
  // 캡나시 M 사이즈 4개 리스팅 (실 구성 반영) — 모두 whiteM/blackM 공유
  const P2: SetItem[] = [
    { optionId: 'whiteM', perSet: 1 },
    { optionId: 'blackM', perSet: 1 },
  ] // 2장 세트
  const P3a: SetItem[] = [
    { optionId: 'whiteM', perSet: 2 },
    { optionId: 'blackM', perSet: 1 },
  ] // 3장 #3
  const P3b: SetItem[] = [
    { optionId: 'whiteM', perSet: 1 },
    { optionId: 'blackM', perSet: 2 },
  ] // 3장 #4
  const P5: SetItem[] = [
    { optionId: 'whiteM', perSet: 3 },
    { optionId: 'blackM', perSet: 2 },
  ] // 5장 세트
  const CAP_M = [
    { listingId: 'cap2', items: P2 },
    { listingId: 'cap3a', items: P3a },
    { listingId: 'cap3b', items: P3b },
    { listingId: 'cap5', items: P5 },
  ]
  // 옵션 자체 net 수요(loadOptionDemand 집계) — 저재고 가정으로 비-0(라이브는 재고가 마스킹)
  const net = new Map<string, number>([
    ['whiteM', 78],
    ['blackM', 78],
  ])

  test('구 방식(세트별 병목 사이징 → 분해합산)은 공유 옵션을 ×N 과다집계 (버그 재현)', () => {
    const decomposed = decomposeSetsToOptions(
      CAP_M.map((s) => ({ listingId: s.listingId, setQty: suggestSetQty(s.items, net), items: s.items }))
    )
    // 4개 리스팅이 각각 whiteM/blackM 78 을 독립 커버 → 분해합산이 78 을 ×5 이상 초과
    expect(decomposed.get('whiteM')!).toBeGreaterThanOrEqual(78 * 5)
    expect(decomposed.get('blackM')!).toBeGreaterThanOrEqual(78 * 4)
  })

  test('신 방식 — 옵션 자체 수요 합은 구 방식 분해합산보다 크게 작다 (인플레이션 제거)', () => {
    // 구 방식: 4개 리스팅 각각 78 커버 → 분해합산
    const old = decomposeSetsToOptions(
      CAP_M.map((s) => ({ listingId: s.listingId, setQty: suggestSetQty(s.items, net), items: s.items }))
    )
    const oldTotal = (old.get('whiteM') ?? 0) + (old.get('blackM') ?? 0)
    // 신 방식: 옵션 finalQty = 옵션 자체 net 수요(세트 재-사이징 합산 없음)
    const newTotal = (net.get('whiteM') ?? 0) + (net.get('blackM') ?? 0)
    expect(newTotal).toBe(156) // 78 + 78
    expect(oldTotal).toBeGreaterThan(newTotal * 4) // 분해합산이 자체수요를 4배 넘게 초과
  })

  test('세트 표시값 = 옵션 발주수량의 역산(min floor) — 읽기전용 참고', () => {
    // 옵션 발주 whiteM=78 blackM=78 → 각 세트가 구성 가능한 완성 세트 수
    expect(computeSetAvailable(P2, net)).toBe(78) // min(78/1, 78/1)
    expect(computeSetAvailable(P3a, net)).toBe(39) // min(floor(78/2)=39, 78/1)
    expect(computeSetAvailable(P5, net)).toBe(26) // min(floor(78/3)=26, floor(78/2)=39)
  })
})
