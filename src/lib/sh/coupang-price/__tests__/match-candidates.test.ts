import { computeMatchCandidates } from '../match-candidates'

const listings = [
  { id: 'L-A1', items: [{ optionId: 'A1', quantity: 1 }] },
  { id: 'L-SET', items: [{ optionId: 'A1', quantity: 1 }, { optionId: 'B1', quantity: 2 }] },
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
  ['sku-set', [{ optionId: 'B1', quantity: 2 }, { optionId: 'A1', quantity: 1 }]],
  ['sku-b1', [{ optionId: 'B1', quantity: 1 }]],
])
const run = (items: Array<{ id: string; rgVendorItemId: string | null; listingId: string | null }>) =>
  computeMatchCandidates({ items, skuByVendorItemId, compositionBySku, listings })

test('재고 매핑 구성과 같은 리스팅 1개 → 후보 (세트 포함)', () => {
  const r = run([
    { id: 'i1', rgVendorItemId: 'rg-a1', listingId: null },
    { id: 'i2', rgVendorItemId: 'rg-set', listingId: null },
  ])
  expect(r.get('i1')).toEqual({ status: 'CANDIDATE', candidateListingIds: ['L-A1'] })
  expect(r.get('i2')).toEqual({ status: 'CANDIDATE', candidateListingIds: ['L-SET'] })
})

test('같은 구성 리스팅 2개 → 모호', () => {
  expect(run([{ id: 'i', rgVendorItemId: 'rg-b1', listingId: null }]).get('i')).toEqual({
    status: 'AMBIGUOUS',
    candidateListingIds: ['L-B1a', 'L-B1b'],
  })
})

test('RG 축이 없거나 재고 매핑이 없으면 없음(수동)', () => {
  const r = run([
    { id: 'mp-only', rgVendorItemId: null, listingId: null },
    { id: 'no-sku', rgVendorItemId: 'rg-unknown', listingId: null },
  ])
  expect(r.get('mp-only')).toEqual({ status: 'NONE', candidateListingIds: [] })
  expect(r.get('no-sku')).toEqual({ status: 'NONE', candidateListingIds: [] })
})

test('확정된 매칭은 덮지 않는다 — 후보가 다르면 확인 필요만 표시', () => {
  const r = run([
    { id: 'same', rgVendorItemId: 'rg-a1', listingId: 'L-A1' },
    { id: 'diff', rgVendorItemId: 'rg-a1', listingId: 'L-SET' },
    { id: 'manual', rgVendorItemId: null, listingId: 'L-A1' },
  ])
  expect(r.get('same')).toEqual({ status: 'CONFIRMED', candidateListingIds: ['L-A1'] })
  expect(r.get('diff')).toEqual({ status: 'NEEDS_REVIEW', candidateListingIds: ['L-A1'] })
  expect(r.get('manual')).toEqual({ status: 'CONFIRMED', candidateListingIds: [] })
})
