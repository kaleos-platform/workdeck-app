import { computeMatchCandidates } from '../match-candidates'

const listings = [
  { id: 'L-A1', items: [{ optionId: 'A1', quantity: 1 }] },
  {
    id: 'L-SET',
    items: [
      { optionId: 'A1', quantity: 1 },
      { optionId: 'B1', quantity: 2 },
    ],
  },
  { id: 'L-B1a', items: [{ optionId: 'B1', quantity: 1 }] },
  { id: 'L-B1b', items: [{ optionId: 'B1', quantity: 1 }] },
]
const skuByVendorItemId = new Map([
  ['rg-a1', 'sku-a1'],
  ['rg-set', 'sku-set'],
  ['rg-b1', 'sku-b1'],
])
const compositionBySku = new Map([
  ['sku-a1', [{ optionId: 'A1', quantity: 1 }]],
  [
    'sku-set',
    [
      { optionId: 'B1', quantity: 2 },
      { optionId: 'A1', quantity: 1 },
    ],
  ],
  ['sku-b1', [{ optionId: 'B1', quantity: 1 }]],
])
const run = (
  items: Array<{ id: string; rgVendorItemId: string | null; listingId: string | null }>
) => computeMatchCandidates({ items, skuByVendorItemId, compositionBySku, listings })

test('재고 매핑 구성과 같은 리스팅 1개 → 후보 (세트 포함)', () => {
  const r = run([
    { id: 'i1', rgVendorItemId: 'rg-a1', listingId: null },
    { id: 'i2', rgVendorItemId: 'rg-set', listingId: null },
  ])
  expect(r.get('i1')).toMatchObject({ status: 'CANDIDATE', candidateListingIds: ['L-A1'] })
  expect(r.get('i2')).toMatchObject({ status: 'CANDIDATE', candidateListingIds: ['L-SET'] })
})

test('같은 구성 리스팅 2개 → 모호', () => {
  expect(run([{ id: 'i', rgVendorItemId: 'rg-b1', listingId: null }]).get('i')).toMatchObject({
    status: 'AMBIGUOUS',
    candidateListingIds: ['L-B1a', 'L-B1b'],
  })
})

test('RG 축이 없거나 재고 매핑이 없으면 없음(수동)', () => {
  const r = run([
    { id: 'mp-only', rgVendorItemId: null, listingId: null },
    { id: 'no-sku', rgVendorItemId: 'rg-unknown', listingId: null },
  ])
  expect(r.get('mp-only')).toMatchObject({ status: 'NONE', candidateListingIds: [] })
  expect(r.get('no-sku')).toMatchObject({ status: 'NONE', candidateListingIds: [] })
})

test('확정된 매칭은 덮지 않는다 — 후보가 다르면 확인 필요만 표시', () => {
  const r = run([
    { id: 'same', rgVendorItemId: 'rg-a1', listingId: 'L-A1' },
    { id: 'diff', rgVendorItemId: 'rg-a1', listingId: 'L-SET' },
    { id: 'manual', rgVendorItemId: null, listingId: 'L-A1' },
  ])
  expect(r.get('same')).toMatchObject({ status: 'CONFIRMED', candidateListingIds: ['L-A1'] })
  expect(r.get('diff')).toMatchObject({ status: 'NEEDS_REVIEW', candidateListingIds: ['L-A1'] })
  expect(r.get('manual')).toMatchObject({ status: 'CONFIRMED', candidateListingIds: [] })
})

test('여러 미연결 옵션이 같은 리스팅을 유일 후보로 가지면 모호 — 일괄 확정이 둘 다 잇지 않게', () => {
  const r = computeMatchCandidates({
    items: [
      { id: 'x', rgVendorItemId: 'rg-x', listingId: null },
      { id: 'y', rgVendorItemId: 'rg-y', listingId: null },
    ],
    skuByVendorItemId: new Map([
      ['rg-x', 'sku1'],
      ['rg-y', 'sku2'],
    ]),
    compositionBySku: new Map([
      ['sku1', [{ optionId: 'A1', quantity: 1 }]],
      ['sku2', [{ optionId: 'A1', quantity: 1 }]],
    ]),
    listings,
  })
  expect(r.get('x')).toMatchObject({ status: 'AMBIGUOUS', candidateListingIds: ['L-A1'] })
  expect(r.get('y')).toMatchObject({ status: 'AMBIGUOUS', candidateListingIds: ['L-A1'] })
})

test('유일 후보 리스팅이 이미 다른 옵션에 연결돼 있으면 모호', () => {
  const r = run([
    { id: 'linked', rgVendorItemId: null, listingId: 'L-A1' },
    { id: 'i', rgVendorItemId: 'rg-a1', listingId: null },
  ])
  expect(r.get('i')).toMatchObject({ status: 'AMBIGUOUS', candidateListingIds: ['L-A1'] })
  expect(r.get('linked')).toMatchObject({ status: 'CONFIRMED', candidateListingIds: [] })
})

describe('매칭 안 함(제외)', () => {
  const base = { listingId: null, excluded: false }
  test('제외 항목은 EXCLUDED 이고 같은 리스팅을 노리는 다른 항목의 경쟁자로 세지 않는다', () => {
    const r = computeMatchCandidates({
      items: [
        { id: 'keep', rgVendorItemId: 'rg-a1', ...base },
        { id: 'dup', rgVendorItemId: 'rg-a1b', ...base, excluded: true },
      ],
      skuByVendorItemId: new Map([...skuByVendorItemId, ['rg-a1b', 'sku-a1b']]),
      compositionBySku: new Map([
        ...compositionBySku,
        ['sku-a1b', [{ optionId: 'A1', quantity: 1 }]],
      ]),
      listings,
    })
    expect(r.get('dup')?.status).toBe('EXCLUDED')
    expect(r.get('keep')).toMatchObject({
      status: 'CANDIDATE',
      candidateListingIds: ['L-A1'],
      conflictItemIds: [],
    })
  })

  test('같은 리스팅을 노리는 다른 항목·이미 연결된 항목을 충돌로 알려준다', () => {
    const r = computeMatchCandidates({
      items: [
        { id: 'x', rgVendorItemId: 'rg-a1', ...base },
        { id: 'y', rgVendorItemId: 'rg-a1b', ...base },
        { id: 'z', rgVendorItemId: 'rg-set', ...base },
        { id: 'w', rgVendorItemId: null, listingId: 'L-SET', excluded: false },
      ],
      skuByVendorItemId: new Map([...skuByVendorItemId, ['rg-a1b', 'sku-a1b']]),
      compositionBySku: new Map([
        ...compositionBySku,
        ['sku-a1b', [{ optionId: 'A1', quantity: 1 }]],
      ]),
      listings,
    })
    expect(r.get('x')).toMatchObject({ status: 'AMBIGUOUS', conflictItemIds: ['y'] })
    expect(r.get('y')).toMatchObject({ status: 'AMBIGUOUS', conflictItemIds: ['x'] })
    expect(r.get('z')).toMatchObject({ status: 'AMBIGUOUS', conflictItemIds: ['w'] })
  })
})
