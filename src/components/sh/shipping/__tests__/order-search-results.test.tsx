import { render, screen, within } from '@testing-library/react'
import { OrderSearchResults } from '../order-search-results'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('../order-edit-dialog', () => ({ OrderEditDialog: () => null }))

describe('OrderSearchResults', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('검색 결과를 7개 그룹 컬럼으로 표시한다', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'order-1',
              recipientName: '홍길동',
              phone: '010-1234-5678',
              address: '서울특별시 중구 세종대로 110',
              orderNumber: 'ORDER-20260923-1',
              orderDate: '2026-09-23T03:00:00.000Z',
              paymentAmount: 28000,
              postalCode: '04524',
              deliveryMessage: null,
              memo: '문 앞에 놓아주세요',
              channel: { id: 'channel-1', name: '쿠팡' },
              shippingMethod: { id: 'method-1', name: '택배' },
              items: [{ name: '테스트 상품', quantity: 2 }],
            },
          ],
          total: 1,
          hasMore: false,
        }),
      } as Partial<Response> as Response
    }) as typeof fetch

    render(<OrderSearchResults query="28000" shippingMethods={[]} channels={[]} />)

    const recipient = await screen.findByText('홍길동')
    const table = screen.getByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent)
    ).toEqual([
      '받는분 · 전화번호',
      '주문번호 · 주문일',
      '주소',
      '상품명',
      '배송메모',
      '판매채널',
      '결제금액',
    ])
    expect(table).toHaveClass('min-w-[1080px]')
    expect(table).not.toHaveClass('min-w-[1350px]')

    const row = recipient.closest('tr') as HTMLTableRowElement
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(7)
    expect(cells[0]).toHaveTextContent('홍길동')
    expect(cells[0]).toHaveTextContent('010-1234-5678')
    expect(cells[1]).toHaveTextContent('ORDER-20260923-1')
    expect(cells[1]).toHaveTextContent(/2026.*09.*23/)
    expect(cells[2]).toHaveAttribute('title', '서울특별시 중구 세종대로 110')
    expect(cells[3]).toHaveAttribute('title', '테스트 상품 ×2')
    expect(cells[6]).toHaveTextContent('28,000원')
    expect(cells[6]).toHaveClass('text-right', 'whitespace-nowrap', 'tabular-nums')
  })
})
