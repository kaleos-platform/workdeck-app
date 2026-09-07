import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractVendorItemIds, extractOptionIdentities } from '../endpoints.js'
import type { SellerProductDetail } from '../endpoints.js'

// 회귀 목적: 로켓그로스 상품의 vendorItemId 는 평면 items[].vendorItemId 가 아니라
// items[].rocketGrowthItemData.vendorItemId 에 중첩돼 있다. 이 자리를 놓치면 에러 없이
// 조용히 0건이 나온다(Phase0 실측에서 실제로 재현됨) — 그래서 세 자리를 모두 커버해야 한다.

test('extractVendorItemIds — 평면 items[].vendorItemId 만 있는 경우', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 111,
    items: [{ vendorItemId: 1001 }, { vendorItemId: 1002 }],
  }
  assert.deepEqual(extractVendorItemIds(detail).sort(), ['1001', '1002'])
})

test('extractVendorItemIds — 로켓그로스 중첩(rocketGrowthItemData)만 있는 경우 — 평면 필드는 없음', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 222,
    items: [
      { rocketGrowthItemData: { vendorItemId: 2001 } },
      { rocketGrowthItemData: { vendorItemId: 2002 } },
    ],
  }
  // 평면 vendorItemId 만 읽었다면 여기서 0건이 나왔을 것 — 그게 실측에서 재현된 함정.
  assert.deepEqual(extractVendorItemIds(detail).sort(), ['2001', '2002'])
})

test('extractVendorItemIds — 마켓플레이스 중첩(marketplaceItemData)만 있는 경우', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 333,
    items: [{ marketplaceItemData: { vendorItemId: 3001 } }],
  }
  assert.deepEqual(extractVendorItemIds(detail), ['3001'])
})

test('extractVendorItemIds — 동시운영(평면+로켓그로스+마켓플레이스 셋 다) 는 dedup 하여 합집합', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 444,
    items: [
      {
        vendorItemId: 4001,
        rocketGrowthItemData: { vendorItemId: 4001 },
        marketplaceItemData: { vendorItemId: 4002 },
      },
    ],
  }
  assert.deepEqual(extractVendorItemIds(detail).sort(), ['4001', '4002'])
})

test('extractVendorItemIds — items 비어있으면 빈 배열', () => {
  const detail: SellerProductDetail = { sellerProductId: 555, items: [] }
  assert.deepEqual(extractVendorItemIds(detail), [])
})

test('extractVendorItemIds — rocketGrowthItemData/marketplaceItemData 가 null 이어도 안전', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 666,
    items: [{ vendorItemId: 6001, rocketGrowthItemData: null, marketplaceItemData: null }],
  }
  assert.deepEqual(extractVendorItemIds(detail), ['6001'])
})

// team-lead 반려 후: productName 플레이스홀더 대신 이력 역산으로 채우기로 하면서,
// 상품 API 보강 경로도 optionName(=itemName) 을 같이 뽑아야 한다.

test('extractOptionIdentities — 평면 vendorItemId + itemName 페어링', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 111,
    items: [
      { vendorItemId: 1001, itemName: '레드 S' },
      { vendorItemId: 1002, itemName: '블루 M' },
    ],
  }
  assert.deepEqual(
    extractOptionIdentities(detail).sort((a, b) => a.optionId.localeCompare(b.optionId)),
    [
      { optionId: '1001', optionName: '레드 S' },
      { optionId: '1002', optionName: '블루 M' },
    ]
  )
})

test('extractOptionIdentities — 로켓그로스 중첩 vendorItemId 도 같은 item 의 itemName 을 쓴다', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 222,
    items: [{ rocketGrowthItemData: { vendorItemId: 2001 }, itemName: '누드 3P S' }],
  }
  assert.deepEqual(extractOptionIdentities(detail), [{ optionId: '2001', optionName: '누드 3P S' }])
})

test('extractOptionIdentities — itemName 이 없으면 optionName null', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 333,
    items: [{ vendorItemId: 3001 }],
  }
  assert.deepEqual(extractOptionIdentities(detail), [{ optionId: '3001', optionName: null }])
})

test('extractOptionIdentities — 동시운영(평면+로켓그로스+마켓플레이스) 는 같은 optionName 을 공유하며 dedup', () => {
  const detail: SellerProductDetail = {
    sellerProductId: 444,
    items: [
      {
        vendorItemId: 4001,
        rocketGrowthItemData: { vendorItemId: 4001 },
        marketplaceItemData: { vendorItemId: 4002 },
        itemName: '공용 옵션',
      },
    ],
  }
  assert.deepEqual(
    extractOptionIdentities(detail).sort((a, b) => a.optionId.localeCompare(b.optionId)),
    [
      { optionId: '4001', optionName: '공용 옵션' },
      { optionId: '4002', optionName: '공용 옵션' },
    ]
  )
})
