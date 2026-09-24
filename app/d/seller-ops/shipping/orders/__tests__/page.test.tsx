import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { Ref } from 'react'
import ShippingOrdersPage from '../page'

jest.mock('@/components/sh/shipping/batch-list', () => ({
  BatchList: ({
    onSelect,
    onCollapse,
    collapseButtonRef,
    dateFrom,
    dateTo,
  }: {
    onSelect: (batchId: string) => void
    onCollapse: () => void
    collapseButtonRef?: Ref<HTMLButtonElement>
    dateFrom?: string
    dateTo?: string
  }) => (
    <div>
      <div>
        묶음 기간: {dateFrom}~{dateTo}
      </div>
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

jest.mock('@/components/sh/shipping/order-search-results', () => ({
  OrderSearchResults: () => <div>검색 결과</div>,
}))

describe('ShippingOrdersPage', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-23T15:00:00.000Z').getTime())
    global.fetch = jest.fn(async () => ({
      json: async () => ({ methods: [], channels: [] }),
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('기간 설정과 통합 검색을 작업 영역 위의 하나의 필터 영역에 표시한다', async () => {
    await act(async () => {
      render(<ShippingOrdersPage />)
    })

    const filter = screen.getByRole('region', { name: '배송 데이터 필터' })
    const workspace = screen.getByRole('region', { name: '배송 데이터 작업 영역' })
    expect(within(filter).getByRole('button', { name: '7일' })).toBeInTheDocument()
    expect(within(filter).getByRole('textbox', { name: '배송 데이터 검색' })).toBeInTheDocument()
    expect(
      filter.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('묶음 기간: 2026-09-17~2026-09-24')).toBeInTheDocument()
  })

  test('30일 프리셋을 선택하면 BatchList에 새 기간을 전달한다', async () => {
    await act(async () => {
      render(<ShippingOrdersPage />)
    })

    fireEvent.click(screen.getByRole('button', { name: '30일' }))

    expect(screen.getByText('묶음 기간: 2026-08-25~2026-09-24')).toBeInTheDocument()
  })

  test('검색 결과를 표시하는 동안에도 통합 필터 영역을 유지한다', async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-09-23T15:00:00.000Z'))

    try {
      await act(async () => {
        render(<ShippingOrdersPage />)
      })

      fireEvent.change(screen.getByRole('textbox', { name: '배송 데이터 검색' }), {
        target: { value: '28000' },
      })
      act(() => {
        jest.advanceTimersByTime(300)
      })

      expect(screen.getByText('검색 결과')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: '배송 데이터 필터' })).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
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
