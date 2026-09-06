import {
  buildStockStatusProducts,
  filterStockStatusProducts,
  scopeStockStatusRows,
  stockStatusDisplayName,
} from '../stock-status-view-model'
import type { StockMatrixRow } from '../stock-status.types'

const rows: StockMatrixRow[] = [
  {
    optionId: 'opt-a',
    sku: 'SKU-A',
    optionName: '화이트 / M',
    productId: 'prod-a',
    productName: '알파',
    productInternalName: null,
    productCode: null,
    brandId: 'brand-a',
    brandName: '브랜드A',
    groupId: 'group-a',
    groupName: '상의',
    costPrice: null,
    retailPrice: null,
    safetyStockQty: 0,
    currentQty: 10,
    totalQty: 10,
    totalValue: 0,
    byLocation: { 'loc-1': 3, 'loc-2': 7 },
    externalCodeByLocation: {},
    incomingQty: 0,
    out30d: 4,
    out90d: 8,
    status: 'OK',
  },
  {
    optionId: 'opt-b',
    sku: 'SKU-B',
    optionName: '블랙 / S',
    productId: 'prod-b',
    productName: '베타',
    productInternalName: null,
    productCode: null,
    brandId: 'brand-b',
    brandName: '브랜드B',
    groupId: 'group-b',
    groupName: '하의',
    costPrice: null,
    retailPrice: null,
    safetyStockQty: 0,
    currentQty: 6,
    totalQty: 6,
    totalValue: 0,
    byLocation: { 'loc-2': 6 },
    externalCodeByLocation: {},
    incomingQty: 0,
    out30d: 2,
    out90d: 5,
    status: 'OK',
  },
]

describe('stock status view model', () => {
  it('선택 위치로 행을 좁혀도 합계 수량과 상태는 전체 합계 기준을 유지한다', () => {
    const scoped = scopeStockStatusRows(rows, 'loc-1')

    expect(scoped).toHaveLength(1)
    expect(scoped[0].displayQty).toBe(10)
    expect(scoped[0].displayStatus).toBe('OK')
  })

  it('30일 출고량 내림차순 → 재고 내림차순으로 정렬한다', () => {
    // 출고 0 · 재고 9999 상품을 추가 → 출고량 있는 상품보다 뒤로 밀려야 한다
    const deadStock: StockMatrixRow = {
      ...rows[0],
      optionId: 'opt-c',
      productId: 'prod-c',
      productName: '감마',
      currentQty: 9999,
      totalQty: 9999,
      byLocation: { 'loc-2': 9999 },
      out30d: 0,
      out90d: 0,
    }
    const products = buildStockStatusProducts([...rows, deadStock], null)

    expect(products.map((p) => p.productId)).toEqual(['prod-a', 'prod-b', 'prod-c'])
    expect(products.map((p) => p.out30d)).toEqual([4, 2, 0])
  })

  it('30일 출고량이 같으면 현재고 내림차순으로 정렬한다', () => {
    const tie: StockMatrixRow = {
      ...rows[1],
      optionId: 'opt-d',
      productId: 'prod-d',
      productName: '델타',
      out30d: 4,
      currentQty: 50,
      totalQty: 50,
      byLocation: { 'loc-2': 50 },
    }
    const products = buildStockStatusProducts([...rows, tie], null)

    // prod-a(out30d 4·현재고 10) < prod-d(out30d 4·현재고 50)
    expect(products.map((p) => p.productId)).toEqual(['prod-d', 'prod-a', 'prod-b'])
  })

  it('관리용 상품명이 있으면 표시명·검색이 관리명을 따른다', () => {
    const named: StockMatrixRow = {
      ...rows[0],
      productInternalName: '알파 벌크',
    }
    const products = buildStockStatusProducts([named], null)

    expect(stockStatusDisplayName(products[0])).toBe('알파 벌크')
    expect(
      filterStockStatusProducts(products, {
        brandId: null,
        groupId: null,
        pinnedProductIds: [],
        query: '벌크',
      })
    ).toHaveLength(1)
  })

  it('고정 상품을 먼저 보여주고 이름순으로 정렬한다', () => {
    const products = buildStockStatusProducts(rows, null)
    const filtered = filterStockStatusProducts(products, {
      brandId: null,
      groupId: null,
      pinnedProductIds: ['prod-b'],
      query: '',
    })

    expect(filtered.map((p) => p.productId)).toEqual(['prod-b', 'prod-a'])
  })
})
