import { render, screen } from '@testing-library/react'
import { SubscriptionSettingsClient } from '../subscription-settings-client'

let mockSubscribeParam = ''
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSubscribeParam),
}))

const product = {
  name: '테스트 업무',
  pricingMode: 'SUBSCRIPTION',
  monthlyPrice: 10000,
  effectivePrice: 10000,
  paidActivatedAt: null,
  isActive: true,
  comingSoon: false,
}
test('Space 전체 체험 대신 덱별 종료일과 만료 사유를 표시한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      role: 'MEMBER',
      products: [
        { ...product, id: 'trial-deck' },
        { ...product, id: 'ended-deck', name: '만료 업무' },
        { ...product, id: 'exempt-deck', name: '면제 업무' },
      ],
      subscription: {
        status: 'TRIALING',
        trialEndsAt: '2099-01-01T00:00:00Z',
        currentPeriodEnd: null,
        exemptFlag: false,
        items: [],
      },
      method: null,
      charges: [],
      entitlement: {
        allowedDecks: ['trial-deck', 'exempt-deck'],
        lockedDecks: ['ended-deck'],
        decks: {
          'trial-deck': {
            allowed: true,
            reason: 'TRIAL',
            trialEndsAt: '2026-12-01T15:00:00Z',
            exempt: false,
          },
          'ended-deck': {
            allowed: false,
            reason: 'LOCKED',
            trialEndsAt: '2026-10-01T15:00:00Z',
            exempt: false,
          },
          'exempt-deck': { allowed: true, reason: 'EXEMPT', trialEndsAt: null, exempt: true },
        },
      },
    }),
  })
  render(<SubscriptionSettingsClient />)
  expect(await screen.findByText(/체험 종료일:.*2026년 12월 1일.*KST/)).toBeInTheDocument()
  expect(screen.getByText(/체험 종료:.*2026년 10월 1일.*KST/)).toBeInTheDocument()
  expect(screen.getByText('면제 이용 중')).toBeInTheDocument()
  expect(screen.queryByText(/2099/)).not.toBeInTheDocument()
  expect(screen.getByText(/체험 종료 후 자동 결제되지 않습니다/)).toBeInTheDocument()
})

test('면제된 업무는 직접 구독 링크로 들어와도 결제 모달을 열지 않는다', async () => {
  mockSubscribeParam = 'subscribe=exempt-deck'
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      role: 'OWNER',
      products: [{ ...product, id: 'exempt-deck', name: '면제 업무' }],
      subscription: null,
      method: null,
      charges: [],
      entitlement: {
        allowedDecks: ['exempt-deck'],
        lockedDecks: [],
        decks: {
          'exempt-deck': { allowed: true, reason: 'EXEMPT', trialEndsAt: null, exempt: true },
        },
      },
    }),
  })
  render(<SubscriptionSettingsClient />)
  expect(await screen.findByText('면제 이용 중')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '구독' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '구독 시작' })).not.toBeInTheDocument()
  mockSubscribeParam = ''
})
