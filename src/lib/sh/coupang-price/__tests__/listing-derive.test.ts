import { deriveListings } from '../listing-derive'

const group = { optionIds: ['op-green', 'op-beige', 'op-charcoal'], quantity: 1 }

test('구성 시그니처가 일치하는 리스팅을 색상 수만큼 찾는다', () => {
  const listings = [
    { id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
    { id: 'L-charcoal', items: [{ optionId: 'op-charcoal', quantity: 1 }] },
    { id: 'L-green-2', items: [{ optionId: 'op-green', quantity: 2 }] }, // 수량 다름 → 제외
    { id: 'L-other', items: [{ optionId: 'op-xxx', quantity: 1 }] },
  ]
  const r = deriveListings(group, listings)
  expect(r.matched.sort()).toEqual(['L-beige', 'L-charcoal', 'L-green'])
  expect(r.ambiguous).toEqual([])
  expect(r.unmatched).toEqual([])
})

test('같은 구성 리스팅이 2개면 모호로 분류하고 matched 에 넣지 않는다', () => {
  const listings = [
    { id: 'L-a', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-b', items: [{ optionId: 'op-green', quantity: 1 }] },
    { id: 'L-beige', items: [{ optionId: 'op-beige', quantity: 1 }] },
  ]
  const r = deriveListings(group, listings)
  expect(r.matched).toEqual(['L-beige'])
  expect(r.ambiguous).toEqual([['L-a', 'L-b']])
  // 모호(ambiguous)와 미매칭(unmatched)은 다르다 — op-charcoal 은 리스팅 자체가 없다.
  expect(r.unmatched).toEqual(['op-charcoal'])
})

test('구성품이 2종인 혼합 세트는 순서와 무관하게 같은 시그니처', () => {
  const mixed = { optionIds: ['op-a'], quantity: 1 }
  const listings = [
    {
      id: 'L-mix',
      items: [
        { optionId: 'op-b', quantity: 1 },
        { optionId: 'op-a', quantity: 1 },
      ],
    },
  ]
  // 단일 옵션 그룹은 2종 구성 리스팅과 일치하지 않는다.
  expect(deriveListings(mixed, listings).matched).toEqual([])
})

test('리스팅이 없는 옵션은 unmatched 로 돌려준다', () => {
  const r = deriveListings(group, [
    { id: 'L-green', items: [{ optionId: 'op-green', quantity: 1 }] },
  ])
  expect(r.matched).toEqual(['L-green'])
  expect(r.unmatched).toEqual(['op-beige', 'op-charcoal'])
})
