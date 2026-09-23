import {
  buildStockStatusProducts,
  filterStockStatusProducts,
  gradeStock,
  scopeStockStatusRows,
  stockStatusDisplayName,
  summarizeStockStatus,
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
    leadTimeDays: 7,
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
    leadTimeDays: 7,
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
  it('선택 위치로 좁히면 수량은 그 위치 재고, 등급·커버 일수는 계산하지 않는다', () => {
    // 위치별 출고 집계가 없어 분모가 전사 값 → 나누면 전 행이 위험으로 보이는 거짓 신호가 된다
    const scoped = scopeStockStatusRows(rows, 'loc-1')

    expect(scoped).toHaveLength(1)
    expect(scoped[0].displayQty).toBe(3)
    expect(scoped[0].grade).toBeNull()
    expect(scoped[0].daysOfCover).toBeNull()
  })

  it('전체 위치에서는 계획재고 기준으로 등급·커버 일수를 매긴다', () => {
    const scoped = scopeStockStatusRows(rows, null)

    // opt-a: 재고 10, 30일 출고 4 → 일평균 0.133 → 75일치, 리드타임 7일의 2배 초과 → 여유
    expect(scoped[0].displayQty).toBe(10)
    expect(scoped[0].grade).toBe('HEALTHY')
    expect(Math.round(scoped[0].daysOfCover!)).toBe(75)
  })

  it('출고량 정렬에서 30일 출고량 내림차순 → 재고 내림차순으로 정렬한다', () => {
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
    const products = filterStockStatusProducts(
      buildStockStatusProducts([...rows, deadStock], null),
      { brandId: null, groupId: null, pinnedProductIds: [], query: '', sort: 'outbound' }
    )

    expect(products.map((p) => p.productId)).toEqual(['prod-a', 'prod-b', 'prod-c'])
    expect(products.map((p) => p.out30d)).toEqual([4, 2, 0])
  })

  it('출고량 정렬에서 30일 출고량이 같으면 현재고 내림차순으로 정렬한다', () => {
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
    const products = filterStockStatusProducts(buildStockStatusProducts([...rows, tie], null), {
      brandId: null,
      groupId: null,
      pinnedProductIds: [],
      query: '',
      sort: 'outbound',
    })

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

  it('재고가 0 이하여도 출고 이력이 없으면 미입고(출고없음)로 본다', () => {
    // 등록만 하고 입고한 적 없는 옵션이 '위험'으로 잡혀 조치 카운트를 부풀리면 안 된다
    expect(gradeStock(0, 0, 0, 7)).toEqual({ grade: 'NO_OUTBOUND', daysOfCover: null })
    expect(gradeStock(40, 0, 0, 7)).toEqual({ grade: 'NO_OUTBOUND', daysOfCover: null })
  })

  it('출고가 있는데 재고가 0 이하면 재고없음이다', () => {
    expect(gradeStock(0, 190, 190, 7).grade).toBe('NO_STOCK')
    expect(gradeStock(-190, 190, 190, 7).grade).toBe('NO_STOCK')
  })

  it('최근 30일 출고가 없으면 90일 평균으로 폴백한다', () => {
    // 90일 90개 → 일평균 1 → 재고 5 = 5일치, 리드타임 7일 미만이므로 위험
    const result = gradeStock(5, 0, 90, 7)
    expect(result.grade).toBe('RISK')
    expect(result.daysOfCover).toBeCloseTo(5)
  })

  it('리드타임을 넘고 2배 미만이면 발주시기다', () => {
    // 일평균 1 → 재고 10 = 10일치, 리드타임 7 → 7 ≤ 10 < 14
    expect(gradeStock(10, 30, 90, 7).grade).toBe('REORDER')
    // 같은 10일치라도 리드타임이 30일이면 위험
    expect(gradeStock(10, 30, 90, 30).grade).toBe('RISK')
  })

  it('상품 카드 등급은 가장 급한 옵션을 따른다', () => {
    const urgent: StockMatrixRow = {
      ...rows[0],
      optionId: 'opt-a2',
      optionName: '화이트 / S',
      currentQty: 1,
      totalQty: 1,
      byLocation: { 'loc-1': 1 },
      out30d: 30,
      out90d: 60,
    }
    const [card] = buildStockStatusProducts([rows[0], urgent], null)

    // opt-a 는 75일치(여유)지만 opt-a2 가 1일치(위험) → 카드는 위험
    expect(card.grade).toBe('RISK')
    expect(card.riskOptionCount).toBe(1)
    expect(Math.round(card.daysOfCover!)).toBe(1)
  })

  it('요약은 위험·재고없음 상품 수와 재고없음 옵션 수를 센다', () => {
    const noStock: StockMatrixRow = {
      ...rows[1],
      optionId: 'opt-z',
      productId: 'prod-z',
      productName: '제타',
      currentQty: 0,
      totalQty: 0,
      byLocation: { 'loc-2': 0 },
      out30d: 30,
      out90d: 60,
    }
    const summary = summarizeStockStatus(buildStockStatusProducts([...rows, noStock], null))

    expect(summary.riskProductCount).toBe(1)
    expect(summary.noStockOptionCount).toBe(1)
  })
})
