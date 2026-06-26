import { render, screen } from '@testing-library/react'
import { StockStatusToolbar } from '../stock-status-toolbar'

describe('stock status toolbar', () => {
  it('옵션 상세 필터만 렌더링하고 위치 탭은 포함하지 않는다', () => {
    render(
      <StockStatusToolbar
        q=""
        onlyLow={false}
        onSearchChange={jest.fn()}
        onOnlyLowChange={jest.fn()}
        onClearFilters={jest.fn()}
      />
    )

    expect(screen.getByPlaceholderText('옵션/SKU 검색')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '전체 위치' })).not.toBeInTheDocument()
  })
})
