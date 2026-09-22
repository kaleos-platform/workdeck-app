import { buildPreviewTargets } from '../build-targets'

const base = {
  channelAxis: 'RG' as const,
  salePrice: 48237, // 할인·프로모션 적용 전
  minMarginPrice: 40191,
  includeVat: true,
  now: new Date('2026-09-22T00:00:00Z'),
  listings: [
    { id: 'L1', name: '리스팅 A' },
    { id: 'L2', name: '리스팅 B' },
  ],
  items: [
    {
      listingId: 'L1',
      rgVendorItemId: '111',
      mpVendorItemId: '211',
      rgSalePrice: 47000,
      mpSalePrice: 47500,
      collectedAt: new Date('2026-09-21T00:00:00Z'),
      sellerProductId: 'SP-1',
    },
  ],
}

test('판매가는 10원 반올림, 하한은 10원 올림', () => {
  const [t] = buildPreviewTargets(base)
  expect(t.targetPrice).toBe(48240)
  expect(t.apMinSalePrice).toBe(40200)
})

test('매핑이 없는 리스팅은 vendorItemId 가 null 이고 차단 사유가 붙는다', () => {
  const targets = buildPreviewTargets(base)
  const l1 = targets.find((t) => t.listingId === 'L1')!
  expect(l1.sellerProductId).toBe('SP-1')
  const l2 = targets.find((t) => t.listingId === 'L2')!
  expect(l2.vendorItemId).toBeNull()
  expect(l2.blockedReason).toContain('연결')
  expect(l2.sellerProductId).toBeNull()
})

test('축에 맞는 현재가를 쓴다 — MP 축은 mpSalePrice', () => {
  const [t] = buildPreviewTargets({ ...base, channelAxis: 'MP' })
  expect(t.vendorItemId).toBe('211')
  expect(t.currentPrice).toBe(47500)
})

test('스냅샷 나이를 시간으로 준다', () => {
  const [t] = buildPreviewTargets(base)
  expect(t.snapshotAgeHours).toBe(24)
})

test('includeVat=false 는 전 타깃이 차단된다', () => {
  const targets = buildPreviewTargets({ ...base, includeVat: false })
  expect(targets.every((t) => t.blockedReason)).toBe(true)
})

test('하한이 판매가 이상이면 차단', () => {
  const targets = buildPreviewTargets({ ...base, minMarginPrice: 99999 })
  expect(targets[0].blockedReason).toContain('최저가')
})

test('변동률을 계산한다', () => {
  const [t] = buildPreviewTargets(base)
  // (48240 - 47000) / 47000
  expect(t.deltaPct).toBeCloseTo(0.0264, 3)
})
