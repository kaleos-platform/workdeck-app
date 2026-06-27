import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StockStatusMatrix } from '../stock-status-matrix'
import { StockStatusProducts } from '../stock-status-products'
import type { StockBrand, StockLocation, StockMatrixRow } from '../stock-status.types'
import { scopeStockStatusRows, type StockStatusProductCard } from '../stock-status-view-model'

const brands: StockBrand[] = [
  {
    id: null,
    name: '브랜드 없음',
    logoUrl: null,
    groups: [],
    healthRatio: { ok: 0, low: 0, out: 0, over: 0, total: 0 },
  },
]

const products: StockStatusProductCard[] = [
  {
    productId: 'product-1',
    productName: '와펜',
    optionCount: 2,
    okOptionCount: 1,
    lowOptionCount: 0,
    outOptionCount: 1,
    overOptionCount: 0,
    brandId: null,
    brandName: null,
    groupId: 'group-1',
    groupName: '기본',
  },
]

const locations: StockLocation[] = [
  {
    id: 'loc-1',
    name: '3PL',
    type: 'THIRD_PARTY',
    skuCount: 1,
    totalQty: 4,
    totalValue: 4000,
    productBreakdown: [],
  },
]

const rows: StockMatrixRow[] = [
  {
    optionId: 'option-1',
    sku: 'SKU-1',
    optionName: '빨강 / M',
    productId: 'product-1',
    productName: '와펜',
    productInternalName: null,
    productCode: null,
    brandId: null,
    brandName: null,
    groupId: 'group-1',
    groupName: '기본',
    costPrice: 1000,
    retailPrice: 2000,
    safetyStockQty: 0,
    currentQty: 4,
    totalQty: 9,
    totalValue: 4000,
    byLocation: { 'loc-1': 4 },
    externalCodeByLocation: {},
    incomingQty: 5,
    out30d: 12,
    out90d: 37,
    status: 'LOW',
  },
]

function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('stock status UI', () => {
  it('상품 패널에서 전체 항목 없이 상품을 선택할 수 있다', () => {
    const onSelectProduct = jest.fn()

    render(
      <StockStatusProducts
        products={products}
        brands={brands}
        loading={false}
        selectedProductId={null}
        selectedBrandId={null}
        selectedGroupId={null}
        productQuery=""
        pinnedProductIds={[]}
        collapsed={false}
        onSelectProduct={onSelectProduct}
        onToggleCollapsed={jest.fn()}
        onTogglePinned={jest.fn()}
        onBrandChange={jest.fn()}
        onGroupChange={jest.fn()}
        onSearchChange={jest.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /^전체$/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /와펜/ }))

    expect(onSelectProduct).toHaveBeenCalledWith('product-1')
    expect(screen.getByText('와펜')).toBeInTheDocument()
  })

  it('상품명을 제목으로 표시하고 30일과 90일 출고량을 표시한다', () => {
    renderWithTooltip(
      <StockStatusMatrix
        rows={scopeStockStatusRows(rows, null)}
        locations={locations}
        loading={false}
        selectedLocationId={null}
        selectedProductName="와펜"
      />
    )

    expect(screen.queryByText('옵션별 재고 현황')).not.toBeInTheDocument()
    expect(screen.queryByText('최신 재고')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '상품명' })).not.toBeInTheDocument()
    expect(screen.getAllByText('와펜')).toHaveLength(2)
    expect(screen.getByText('30일 출고량')).toBeInTheDocument()
    expect(screen.getByText('90일 출고량')).toBeInTheDocument()
    expect(screen.getByText('생산 관리')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('현재 4')).toBeInTheDocument()
  })
})
