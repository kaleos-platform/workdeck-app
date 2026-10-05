import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractProductItems } from '../endpoints.js'
import type { SellerProductDetail } from '../endpoints.js'

// prod 실물 응답에서 가져온 한 item — 핸드오프의 65,790 / 67,800 쌍.
const REAL: SellerProductDetail = {
  sellerProductId: 16324130475,
  sellerProductName: '크림드 선 클렌징 패드 60매',
  statusName: '승인완료',
  items: [
    {
      itemName: '60매 1개',
      rocketGrowthItemData: {
        vendorItemId: 96037831212,
        priceData: { originalPrice: 35000, salePrice: 65790, supplyPrice: 63619 },
        barcode: '8809903551648',
        skuInfo: { width: 90, length: 90, height: 80, weight: 250, quantityPerBox: 1 },
      },
      marketplaceItemData: {
        vendorItemId: 95847019386,
        priceData: { originalPrice: 105000, salePrice: 67800, supplyPrice: 65563 },
        barcode: '',
      },
    },
  ],
} as unknown as SellerProductDetail

test('item 당 1행 — RG·MP 두 축이 한 행에 들어간다', () => {
  const rows = extractProductItems(REAL)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].rgVendorItemId, '96037831212')
  assert.equal(rows[0].mpVendorItemId, '95847019386')
})

test('가격은 priceData.salePrice 2단 중첩에서 읽는다', () => {
  const [row] = extractProductItems(REAL)
  // 평면 salePrice 로 선언했다면 여기서 null 이 나왔을 것 — 무음 실패 유형 3 과 같은 자리.
  assert.equal(row.rgSalePrice, 65790)
  assert.equal(row.mpSalePrice, 67800)
})

test('바코드는 RG 쪽만 채운다 — MP 는 빈 문자열이라 null 로 정규화', () => {
  const [row] = extractProductItems(REAL)
  assert.equal(row.barcode, '8809903551648')
})

test('RG 전용 상품 — MP 필드는 전부 null', () => {
  const rgOnly = {
    sellerProductId: 1,
    items: [
      { itemName: 'A', rocketGrowthItemData: { vendorItemId: 5, priceData: { salePrice: 100 } } },
    ],
  } as unknown as SellerProductDetail
  const [row] = extractProductItems(rgOnly)
  assert.equal(row.rgVendorItemId, '5')
  assert.equal(row.mpVendorItemId, null)
  assert.equal(row.mpSalePrice, null)
})

test('두 축 모두 없는 item 은 버린다 — 쓰기 타깃이 없다', () => {
  const empty = {
    sellerProductId: 1,
    items: [{ itemName: 'A' }],
  } as unknown as SellerProductDetail
  assert.equal(extractProductItems(empty).length, 0)
})
