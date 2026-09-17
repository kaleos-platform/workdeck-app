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
