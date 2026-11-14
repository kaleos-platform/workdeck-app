import { render, screen } from '@testing-library/react'
import { BillingSpaceDetail } from '../billing-space-detail'

test('공간 공통 체험 종료일 대신 업무별 체험·면제 관리 링크를 표시한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      space: { id: 's1', name: '테스트 Space' },
      subscription: {
        id: 'sub1',
        status: 'TRIALING',
        trialEndsAt: '2099-01-01T00:00:00Z',
        currentPeriodEnd: null,
        retryCount: 0,
        exemptFlag: false,
        exemptNote: null,
        provider: null,
        items: [],
      },
      methods: [],
      charges: [],
    }),
  })
  render(<BillingSpaceDetail spaceId="s1" />)
  expect(await screen.findByRole('link', { name: '업무별 체험·면제 관리' })).toHaveAttribute(
    'href',
    '/admin/subscriptions'
  )
  expect(screen.queryByText(/트라이얼 종료|2099/)).not.toBeInTheDocument()
})
