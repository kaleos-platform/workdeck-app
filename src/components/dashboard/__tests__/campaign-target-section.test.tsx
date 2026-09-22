import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import { notifyCampaignsChanged } from '@/hooks/use-campaign-navigation'
import { CampaignTargetSection } from '../campaign-target-section'

jest.mock('@/hooks/use-campaign-navigation', () => ({ notifyCampaignsChanged: jest.fn() }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

const originalFetch = global.fetch
afterEach(() => {
  global.fetch = originalFetch
  jest.clearAllMocks()
})

test.each([
  ['저장', true],
  ['저장', false],
  ['삭제', true],
  ['삭제', false],
] as const)('목표 %s 성공=%s일 때 성공한 변경만 홈에 알린다', async (action, ok) => {
  global.fetch = jest.fn(async (_url, options) => ({
    ok: options?.method ? ok : true,
    json: async () => (options?.method ? {} : []),
  })) as jest.Mock
  render(
    <CampaignTargetSection
      campaignId="c1"
      from="2020-01-01"
      to="2020-01-07"
      mode="budget"
      initialTargets={[
        {
          id: 't1',
          campaignId: 'c1',
          effectiveDate: '2020-01-01',
          dailyBudget: 1000,
          targetRoas: 200,
        },
      ]}
      initialSummary={null}
    />
  )
  if (action === '저장') {
    fireEvent.click(screen.getByRole('button', { name: '예산/목표 ROAS 추가' }))
    fireEvent.change(screen.getByLabelText('일 예산 (원)'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
  } else {
    fireEvent.click(screen.getByRole('button', { name: /변경 이력/ }))
    const row = screen.getByRole('row', { name: /2020-01-01/ })
    fireEvent.click(within(row).getAllByRole('button').at(-1)!)
  }
  await waitFor(() => expect(ok ? toast.success : toast.error).toHaveBeenCalled())
  expect(notifyCampaignsChanged).toHaveBeenCalledTimes(ok ? 1 : 0)
})
