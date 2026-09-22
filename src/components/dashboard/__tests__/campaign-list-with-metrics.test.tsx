import { render, screen, waitFor } from '@testing-library/react'
import { CampaignListWithMetrics } from '../campaign-list-with-metrics'

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
})

test('목록 응답의 목표 요약을 표시하고 캠페인별 추가 API를 호출하지 않는다', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => [
      {
        id: 'c1',
        displayName: '테스트 캠페인',
        adTypes: ['매출 최적화'],
        metrics: { totalAdCost: 100, totalRevenue: 200, avgRoas: 200 },
        prevMetrics: null,
        currentTarget: { dailyBudget: 100, targetRoas: 200 },
        minDate: '2026-09-06',
        maxDate: '2026-09-12',
        summary: { budgetUtilization: 100, roasAchievement: 100 },
      },
    ],
  })
  global.fetch = fetchMock
  render(<CampaignListWithMetrics from="2026-09-06" to="2026-09-12" />)
  await screen.findByText('테스트 캠페인')
  expect(screen.getByText('소진율 100.0%')).toBeInTheDocument()
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
})

test('서버 목록은 재검증을 기다리지 않고 표시하며 기간 변경 시 이전 목록을 숨긴다', () => {
  global.fetch = jest.fn(() => new Promise(() => {})) as typeof fetch
  const initialCampaigns = [
    {
      id: 'c1',
      name: '초기 캠페인',
      displayName: '초기 캠페인',
      adTypes: ['매출 최적화'],
      metrics: { totalAdCost: 100, totalRevenue: 200, avgRoas: 200 },
      prevMetrics: null,
      currentTarget: null,
      minDate: '2026-09-06',
      maxDate: '2026-09-12',
    },
  ]
  const { rerender } = render(
    <CampaignListWithMetrics
      from="2026-09-06"
      to="2026-09-12"
      initialCampaigns={initialCampaigns}
    />
  )
  expect(screen.getByText('초기 캠페인')).toBeVisible()
  rerender(
    <CampaignListWithMetrics
      from="2026-09-01"
      to="2026-09-12"
      initialCampaigns={initialCampaigns}
    />
  )
  expect(screen.queryByText('초기 캠페인')).not.toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledTimes(2)
})
