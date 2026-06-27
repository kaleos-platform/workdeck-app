import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StockStatusMatrix } from '../stock-status-matrix'
import { StockStatusProducts } from '../stock-status-products'
import type { StockLocation, StockMatrixRow, StockProductSummary } from '../stock-status.types'

const products: StockProductSummary[] = [
  {
    productId: 'product-1',
    productName: '와펜',
    optionCount: 2,
    okOptionCount: 1,
    lowOptionCount: 0,
    outOptionCount: 1,
    overOptionCount: 0,
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
  it('상품 패널에 전체 항목을 표시하고 선택할 수 있다', () => {
    const onSelectProduct = jest.fn()

    render(
      <StockStatusProducts
        products={products}
        loading={false}
        selectedProductId={null}
        onSelectProduct={onSelectProduct}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /전체/ }))

    expect(onSelectProduct).toHaveBeenCalledWith(null)
    expect(screen.getByText('와펜')).toBeInTheDocument()
  })

  it('옵션별 재고 현황에 30일과 90일 출고량을 표시한다', () => {
    renderWithTooltip(
      <StockStatusMatrix
        rows={rows}
        locations={locations}
        loading={false}
        selectedLocationId={null}
        selectedProductName="와펜"
      />
    )

    expect(screen.getByText('옵션별 재고 현황')).toBeInTheDocument()
    expect(screen.getByText('30일 출고량')).toBeInTheDocument()
    expect(screen.getByText('90일 출고량')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
  })

  it('합계는 입고예정을 포함하고 현재 보유 재고를 별도로 표시한다', () => {
    renderWithTooltip(
      <StockStatusMatrix
        rows={rows}
        locations={locations}
        loading={false}
        selectedLocationId={null}
        selectedProductName="와펜"
      />
    )

    expect(screen.getByText('입고예정')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('현재 4')).toBeInTheDocument()
  })
})
