import { fireEvent, render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SalesMixProductRow } from '@/lib/coupang-ads/sales-mix'
import { SalesMixTable } from '../sales-mix-table'

const row = (p: Partial<SalesMixProductRow> & { productName: string }): SalesMixProductRow => ({
  productId: p.productName,
  revenue: 0,
  salesQty: 0,
  adCost: 0,
  adShare: null,
  coupangAdRevenueShare: null,
  prevAdShare: null,
  adShareDeltaPp: null,
  revenueChangePct: null,
  status: 'neutral',
  ...p,
})

const rows: SalesMixProductRow[] = [
  row({
    productName: '자연상품',
    revenue: 100000,
    salesQty: 50,
    adCost: 1000,
    adShare: 0.01,
    status: 'organic',
  }),
  row({
    productName: '의존상품',
    revenue: 50000,
    salesQty: 5,
    adCost: 20000,
    adShare: 0.4,
    coupangAdRevenueShare: 1.09,
    status: 'dependent',
  }),
  row({ productName: '중간상품', revenue: 80000, salesQty: 10, adCost: 8000, adShare: 0.1 }),
  row({ productName: '광고만상품', adCost: 3000, status: 'dependent' }),
  row({ productName: '빈상품' }),
  row({ productId: null, productName: '판매 데이터 없음', adCost: 500, status: 'dependent' }),
]

function setup(onSelect = jest.fn()) {
  render(
    <TooltipProvider>
      <SalesMixTable rows={rows} onSelect={onSelect} />
    </TooltipProvider>
  )
  return onSelect
}

const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent)

test('매출·광고비 모두 0 인 행은 기본 숨김, 「매출 0 포함」 체크 시 보인다', () => {
  setup()
  expect(screen.queryByText('빈상품')).not.toBeInTheDocument()
  expect(screen.getByText('광고만상품')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '매출 0 포함' }))
  expect(screen.getByText('빈상품')).toBeInTheDocument()
})

test('필터 칩 건수는 상태 수와 같고 클릭 시 해당 상태만 보인다', () => {
  setup()
  const organic = screen.getByRole('button', { name: '광고 없이 판매 1' })
  const dependent = screen.getByRole('button', { name: '광고 의존 3' })
  fireEvent.click(dependent)
  expect(names()).toEqual(['의존상품', '광고만상품', '판매 데이터 없음'])
  fireEvent.click(organic)
  expect(names()).toEqual(['자연상품'])
})

test('adShare null 은 「—」, 쿠팡 기준 광고매출 비중 1.09 는 「109%」', () => {
  setup()
  const cells = within(screen.getByText('광고만상품').closest('tr')!).getAllByRole('cell')
  expect(cells[4]).toHaveTextContent('—')
  const dep = within(screen.getByText('의존상품').closest('tr')!).getAllByRole('cell')
  expect(dep[7]).toHaveTextContent('109%')
})

test('「판매 데이터 없음」 행 클릭은 onSelect 를 부르지 않는다', () => {
  const onSelect = setup()
  fireEvent.click(screen.getByText('판매 데이터 없음'))
  expect(onSelect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('자연상품'))
  expect(onSelect).toHaveBeenCalledWith('자연상품')
})

test('기본 매출 내림차순, 「광고비 비중」 헤더 클릭 시 내림차순 → 다시 클릭 시 오름차순', () => {
  setup()
  expect(names().slice(0, 3)).toEqual(['자연상품', '중간상품', '의존상품'])
  fireEvent.click(screen.getByRole('button', { name: /광고비 비중/ }))
  expect(names().slice(0, 3)).toEqual(['의존상품', '중간상품', '자연상품'])
  fireEvent.click(screen.getByRole('button', { name: /광고비 비중/ }))
  expect(names().slice(0, 3)).toEqual(['자연상품', '중간상품', '의존상품'])
})
