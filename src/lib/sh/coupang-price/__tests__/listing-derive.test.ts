import { deriveListings, matchesRows } from '../listing-derive'

const single = [{ optionIds: ['op-green', 'op-beige', 'op-charcoal'], quantity: 1 }]

test('단일 행 — 구성 시그니처가 일치하는 리스팅을 색상 수만큼 찾는다', () => {
  const listings = [
    { id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
    { id: 'L-charcoal', items: [{ optionId: 'op-charcoal', quantity: 1 }] },
    { id: 'L-green-2', items: [{ optionId: 'op-green', quantity: 2 }] },
    { id: 'L-other', items: [{ optionId: 'op-xxx', quantity: 1 }] },
  ]
  const r = deriveListings(single, listings)
  expect(r.matched).toEqual(['L-beige', 'L-charcoal', 'L-green'])
  expect(r.ambiguous).toEqual([])
  expect(r.unmatched).toEqual([])
})

test('같은 구성 리스팅이 2개면 모호로 분류하고 matched 에 넣지 않는다', () => {
  const listings = [
    { id: 'L-a', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-b', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
  ]
  const r = deriveListings(single, listings)
  expect(r.matched).toEqual(['L-beige'])
  expect(r.ambiguous).toEqual([['L-a', 'L-b']])
  expect(r.unmatched).toEqual(['op-charcoal'])
})

test('단일 행은 2종 구성 세트 리스팅과 매칭되지 않는다', () => {
  const r = deriveListings(
    [{ optionIds: ['op-a'], quantity: 1 }],
    [
      {
        id: 'L-mix',
        items: [
          { optionId: 'op-b', quantity: 1 },
          { optionId: 'op-a', quantity: 1 },
        ],
      },
    ]
  )
  expect(r.matched).toEqual([])
})

test('2행 세트 — 각 행에서 하나씩 고른 조합 리스팅을 모두 찾고, 단품은 제외한다', () => {
  const rows = [
    { optionIds: ['A1', 'A2'], quantity: 1 },
    { optionIds: ['B1'], quantity: 2 },
  ]
  const listings = [
    {
      id: 'S-A1B1',
      items: [
        { optionId: 'B1', quantity: 2 },
        { optionId: 'A1', quantity: 1 },
      ],
    },
    {
      id: 'S-A2B1',
      items: [
        { optionId: 'A2', quantity: 1 },
        { optionId: 'B1', quantity: 2 },
      ],
    },
    { id: 'single-A1', items: [{ optionId: 'A1', quantity: 1 }] }, // 세트가가 단품에 쓰이면 안 된다
    {
      id: 'S-A1B1-q1',
      items: [
        { optionId: 'A1', quantity: 1 },
        { optionId: 'B1', quantity: 1 },
      ],
    },
  ]
  const r = deriveListings(rows, listings)
  expect(r.matched).toEqual(['S-A1B1', 'S-A2B1'])
  expect(r.unmatched).toEqual([])
})

test('같은 옵션그룹 두 행(A×1 + A×1) 세트도 매칭된다', () => {
  const rows = [
    { optionIds: ['A1', 'A2'], quantity: 1 },
    { optionIds: ['A1', 'A2'], quantity: 1 },
  ]
  expect(
    matchesRows(
      [
        { optionId: 'A2', quantity: 1 },
        { optionId: 'A1', quantity: 1 },
      ],
      rows
    )
  ).toBe(true)
  expect(matchesRows([{ optionId: 'A1', quantity: 1 }], rows)).toBe(false)
})

test('리스팅이 없는 옵션은 unmatched 로 돌려준다', () => {
  const r = deriveListings(single, [
    { id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] },
  ])
  expect(r.unmatched).toEqual(['op-beige', 'op-charcoal'])
})

test('rows 가 비면 아무것도 매칭하지 않는다', () => {
  expect(deriveListings([], [{ id: 'L', items: [] }])).toEqual({
    matched: [],
    ambiguous: [],
    unmatched: [],
  })
})
