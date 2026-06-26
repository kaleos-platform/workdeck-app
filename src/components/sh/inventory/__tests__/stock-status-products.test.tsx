import { fireEvent, render, screen } from '@testing-library/react'
import { StockStatusProducts } from '../stock-status-products'
import type { StockStatusProductCard } from '../stock-status-view-model'

const products: StockStatusProductCard[] = [
  {
    productId: 'prod-b',
    productName: '베타',
    optionCount: 1,
    okOptionCount: 1,
    lowOptionCount: 0,
    outOptionCount: 0,
    overOptionCount: 0,
    brandId: 'brand-b',
    brandName: '브랜드B',
    groupId: 'group-b',
    groupName: '하의',
  },
  {
    productId: 'prod-a',
    productName: '알파',
    optionCount: 1,
    okOptionCount: 0,
    lowOptionCount: 1,
    outOptionCount: 0,
    overOptionCount: 0,
    brandId: 'brand-a',
    brandName: '브랜드A',
    groupId: 'group-a',
    groupName: '상의',
  },
]

describe('stock status products panel', () => {
  it('접으면 검색과 상품 목록을 숨기고 펼치기 버튼을 보여준다', () => {
    const { rerender } = render(
      <StockStatusProducts
        products={products}
        brands={[]}
        loading={false}
        selectedProductId={null}
        selectedBrandId={null}
        selectedGroupId={null}
        productQuery=""
        pinnedProductIds={['prod-b']}
        collapsed={false}
        onSelectProduct={jest.fn()}
        onToggleCollapsed={jest.fn()}
        onTogglePinned={jest.fn()}
        onBrandChange={jest.fn()}
        onGroupChange={jest.fn()}
        onSearchChange={jest.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /^전체$/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /패널 접기/ }))

    rerender(
      <StockStatusProducts
        products={products}
        brands={[]}
        loading={false}
        selectedProductId={null}
        selectedBrandId={null}
        selectedGroupId={null}
        productQuery=""
        pinnedProductIds={['prod-b']}
        collapsed
        onSelectProduct={jest.fn()}
        onToggleCollapsed={jest.fn()}
        onTogglePinned={jest.fn()}
        onBrandChange={jest.fn()}
        onGroupChange={jest.fn()}
        onSearchChange={jest.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /패널 펼치기/ })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('상품 검색')).not.toBeInTheDocument()
  })
})
