import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Ref } from 'react'
import ShippingOrdersPage from '../page'

jest.mock('@/components/sh/shipping/batch-list', () => ({
  BatchList: ({
    onSelect,
    onCollapse,
    collapseButtonRef,
  }: {
    onSelect: (batchId: string) => void
    onCollapse: () => void
    collapseButtonRef?: Ref<HTMLButtonElement>
  }) => (
    <div>
      <button ref={collapseButtonRef} onClick={onCollapse}>
        배송 묶음 접기
      </button>
      <button onClick={() => onSelect('batch-1')}>배송 묶음 선택</button>
    </div>
  ),
}))

jest.mock('@/components/sh/shipping/order-detail-table', () => ({
  OrderDetailTable: ({ batchId }: { batchId: string }) => <div>주문 목록: {batchId}</div>,
}))

jest.mock('@/components/sh/shipping/order-search-bar', () => ({
  OrderSearchBar: () => <div>주문 검색</div>,
}))

jest.mock('@/components/sh/shipping/order-search-results', () => ({
  OrderSearchResults: () => <div>검색 결과</div>,
}))

describe('ShippingOrdersPage', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = jest.fn(async () => ({
      json: async () => ({ methods: [], channels: [] }),
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('2xl에서 배송 묶음 패널을 접고 펼칠 수 있다', async () => {
    await act(async () => {
      render(<ShippingOrdersPage />)
    })

    const workspace = screen.getByRole('region', { name: '배송 데이터 작업 영역' })
    expect(workspace).toHaveClass('2xl:grid-cols-[280px_minmax(0,1fr)]')
    expect(screen.getByText('배송 묶음을 선택하세요')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '배송 묶음 펼치기' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '배송 묶음 접기' }))
    expect(workspace).toHaveClass('2xl:grid-cols-[44px_minmax(0,1fr)]')
    expect(
      screen.getByRole('button', { name: '배송 묶음 접기' }).closest('.rounded-lg')
    ).toHaveClass('2xl:hidden')
    const expandButton = screen.getByRole('button', { name: '배송 묶음 펼치기' })
    expect(expandButton.parentElement).toHaveClass('hidden', '2xl:flex')

    fireEvent.click(expandButton)
    expect(workspace).toHaveClass('2xl:grid-cols-[280px_minmax(0,1fr)]')
  })

  test('선택한 배송 묶음 id를 주문 목록으로 전달한다', async () => {
    await act(async () => {
      render(<ShippingOrdersPage />)
    })

    fireEvent.click(screen.getByRole('button', { name: '배송 묶음 선택' }))

    expect(screen.getByText('주문 목록: batch-1')).toBeInTheDocument()
    expect(screen.queryByText('배송 묶음을 선택하세요')).not.toBeInTheDocument()
  })

  test('접기와 펼치기 후 새 버튼으로 keyboard focus를 옮긴다', async () => {
    await act(async () => {
      render(<ShippingOrdersPage />)
    })

    const collapseButton = screen.getByRole('button', { name: '배송 묶음 접기' })
    collapseButton.focus()
    fireEvent.click(collapseButton)
    const expandButton = screen.getByRole('button', { name: '배송 묶음 펼치기' })
    expect(expandButton).toHaveFocus()

    fireEvent.click(expandButton)
    expect(screen.getByRole('button', { name: '배송 묶음 접기' })).toHaveFocus()
  })
})
