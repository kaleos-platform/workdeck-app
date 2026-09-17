import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DashboardClient } from '../dashboard-client'

jest.mock('@/lib/date-range', () => ({
  getTodayStrKst: () => '2026-09-17',
  getDaysAgoStrKst: (days: number) => (days === 1 ? '2026-09-16' : '2026-09-10'),
}))
jest.mock('../campaign-list-with-metrics', () => ({ CampaignListWithMetrics: () => null }))

const kpi = {
  adCost: 1234,
  roas: 200,
  revenue: 2468,
  ctr: 1,
  cvr: 2,
  prevAdCost: 0,
  prevRoas: null,
  prevRevenue: 0,
  prevCtr: null,
  prevCvr: null,
  wow: { adCost: null, roas: null, revenue: null, ctr: null, cvr: null },
}
const initialData = { from: '2026-09-10', to: '2026-09-16', kpi, campaigns: [] }
const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

test('서버 KPI를 즉시 표시하고 재검증 결과로 갱신한다', async () => {
  let resolve!: (value: unknown) => void
  global.fetch = jest.fn(
    () =>
      new Promise<unknown>((r) => {
        resolve = r
      })
  ) as typeof fetch
  render(<DashboardClient hasData initialData={initialData} />)
  expect(screen.getByText('1,234원')).toBeVisible()
  await act(async () => {
    resolve({ ok: true, json: async () => ({ ...kpi, adCost: 5678 }) })
  })
  expect(await screen.findByText('5,678원')).toBeVisible()
})

test('기간 전환 중 이전 수치를 숨기고 오래된 응답이 최신 기간을 덮지 않는다', async () => {
  const resolve: Array<(value: unknown) => void> = []
  global.fetch = jest.fn(() => new Promise<unknown>((r) => resolve.push(r))) as typeof fetch
  const { container } = render(<DashboardClient hasData initialData={initialData} />)
  fireEvent.change(container.querySelector('input[type="date"]')!, {
    target: { value: '2026-09-01' },
  })
  expect(screen.queryByText('1,234원')).not.toBeInTheDocument()
  await waitFor(() => expect(resolve).toHaveLength(2))
  await act(async () => {
    resolve[1]({ ok: true, json: async () => ({ ...kpi, adCost: 9000 }) })
  })
  expect(await screen.findByText('9,000원')).toBeVisible()
  await act(async () => {
    resolve[0]({ ok: true, json: async () => ({ ...kpi, adCost: 8000 }) })
  })
  expect(screen.getByText('9,000원')).toBeVisible()
  expect(screen.queryByText('8,000원')).not.toBeInTheDocument()
})

test('서버 props 갱신은 API를 재검증하고 최신 값을 반영한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => kpi })
  const { rerender } = render(<DashboardClient hasData initialData={initialData} />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
  await act(async () => {})
  jest
    .mocked(global.fetch)
    .mockResolvedValue({ ok: true, json: async () => ({ ...kpi, adCost: 7000 }) } as Response)
  rerender(
    <DashboardClient hasData initialData={{ ...initialData, kpi: { ...kpi, adCost: 7000 } }} />
  )
  expect(await screen.findByText('7,000원')).toBeVisible()
  expect(global.fetch).toHaveBeenCalledTimes(2)
})
