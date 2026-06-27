import {
  buildStockStatusProducts,
  filterStockStatusProducts,
  scopeStockStatusRows,
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
