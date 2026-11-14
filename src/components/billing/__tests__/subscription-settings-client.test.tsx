import { fireEvent, render, screen } from '@testing-library/react'
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

test('전액 환불로 종료된 구독은 해지 예정일 대신 환불 완료를 안내한다', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      role: 'OWNER',
      products: [{ ...product, id: 'recruiting' }],
      subscription: {
        status: 'CANCELED',
        currentPeriodEnd: null,
        exemptFlag: false,
        trialEndsAt: null,
        items: [],
      },
      method: null,
      charges: [{ status: 'REFUNDED', periodEnd: '2026-12-14T00:00:00Z' }],
      entitlement: {
        allowedDecks: [],
        lockedDecks: ['recruiting'],
        decks: { recruiting: { allowed: false, reason: 'LOCKED', trialEndsAt: null } },
      },
    }),
  })
  render(<SubscriptionSettingsClient />)
  expect(
    await screen.findByText(/마지막 결제가 전액 취소되어 유료 구독이 종료되었습니다/)
  ).toBeInTheDocument()
  expect(screen.queryByText(/이후 구독이 종료됩니다/)).not.toBeInTheDocument()
})

function overview(extra: Record<string, unknown>) {
  return {
    role: 'OWNER',
    products: [{ ...product, id: 'trial-deck' }],
    subscription: {
      status: 'TRIALING',
      trialEndsAt: null,
      currentPeriodEnd: null,
      exemptFlag: false,
      items: [],
    },
    method: { cardSummary: '신한 1234', createdAt: '2026-11-01T00:00:00Z' },
    charges: [],
    entitlement: {
      allowedDecks: ['trial-deck'],
      lockedDecks: [],
      decks: {
        'trial-deck': {
          allowed: true,
          reason: 'TRIAL',
          trialEndsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
          exempt: false,
        },
      },
    },
    ...extra,
  }
}

test('구독 버튼은 담기 없이 바로 구독(예약) 확인 모달을 연다', async () => {
  mockSubscribeParam = ''
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => overview({}) })
  render(<SubscriptionSettingsClient />)
  fireEvent.click(await screen.findByRole('button', { name: '구독' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('구독을 예약할까요?')
  expect(screen.queryByText('빼기')).not.toBeInTheDocument()
  expect(screen.queryByText('구독 시작')).not.toBeInTheDocument()
  expect(screen.getByText(/^D-\d+$/)).toBeInTheDocument()
})

test('해지는 확인 후에만 요청하고, 예약 업무는 예약 취소로 안내한다', async () => {
  mockSubscribeParam = ''
  const data = overview({
    subscription: {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + 10 * 86400000).toISOString(),
      exemptFlag: false,
      items: [
        {
          id: 'i1',
          deckAppId: 'trial-deck',
          priceSnapshot: 10000,
          status: 'ACTIVE',
          awaitingTrialEnd: true,
        },
      ],
    },
  })
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => data })
  global.fetch = fetchMock
  render(<SubscriptionSettingsClient />)
  expect(await screen.findAllByText('구독 예약')).not.toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '예약 취소' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('구독 예약을 취소할까요?')
  expect(fetchMock).toHaveBeenCalledTimes(1) // overview 만, 해지 요청은 아직 없음
})

test('결제 일시 중지 중에는 구독 버튼을 비활성화한다', async () => {
  mockSubscribeParam = ''
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => overview({ checkoutPaused: true }) })
  render(<SubscriptionSettingsClient />)
  expect(await screen.findByRole('button', { name: '결제 준비 중' })).toBeDisabled()
})
