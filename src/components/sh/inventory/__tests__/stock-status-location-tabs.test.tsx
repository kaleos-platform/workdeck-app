import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StockStatusLocationTabs } from '../stock-status-location-tabs'
import type { StockLocation } from '../stock-status.types'

const locations: StockLocation[] = [
  {
    id: 'loc-1',
    name: '3PL',
    type: 'THIRD_PARTY',
    skuCount: 1,
    totalQty: 10,
    totalValue: 1000,
    productBreakdown: [],
  },
  {
    id: 'loc-2',
    name: '자사창고',
    type: 'OWN',
    skuCount: 1,
    totalQty: 5,
    totalValue: 500,
    productBreakdown: [],
  },
]

describe('stock status location tabs', () => {
  it('전체 위치를 기본 탭으로 두고 위치별 탭을 선택할 수 있다', async () => {
    const user = userEvent.setup()
    const onLocationChange = jest.fn()

    render(
      <StockStatusLocationTabs
        locations={locations}
        selectedLocationId={null}
        onLocationChange={onLocationChange}
      />
    )

    expect(screen.getByRole('tab', { name: '전체 위치' })).toHaveAttribute('data-state', 'active')

    await user.click(screen.getByRole('tab', { name: '3PL' }))

    expect(onLocationChange).toHaveBeenCalledWith('loc-1')
  })
})
