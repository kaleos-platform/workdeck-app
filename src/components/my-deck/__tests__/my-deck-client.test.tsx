import { render, screen, fireEvent } from '@testing-library/react'
import { MyDeckClient } from '../my-deck-client'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))
const deck = { id: 'recruiting', name: '모집 관리', description: null }
const base = {
  spaceName: '테스트',
  spaces: [],
  currentSpaceId: 'sp-1',
  activeDecks: [],
  availableDecks: [{ ...deck, comingSoon: false }],
  subscribedDeckIds: [],
  reservedDeckIds: [],
  checkoutPaused: false,
  isOwner: true,
  cardSummary: null,
  hasActiveSubscription: false,
}
const bill = {
  id: 'recruiting',
  pricingMode: 'SUBSCRIPTION' as const,
  monthlyPrice: 12273,
  listPrice: 20000,
  allowed: true,
}

test('처음 추가할 때 7일 체험과 자동 결제 없음 안내를 먼저 표시한다', () => {
  render(
    <MyDeckClient
      {...base}
      billing={[{ ...bill, allowed: false, reason: 'LOCKED', trialEndsAt: null }]}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 추가 확인 열기' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('7일 무료 체험')
  expect(screen.getByRole('dialog')).toHaveTextContent('자동 결제되지 않습니다')
  expect(screen.getByRole('button', { name: '무료 체험 시작' })).toBeInTheDocument()
})
test('체험 중인 업무는 카드와 재추가 확인에 기존 KST 종료일을 표시한다', () => {
  const billing = [{ ...bill, reason: 'TRIAL' as const, trialEndsAt: '2026-11-20T15:00:00Z' }]
  const { unmount } = render(
    <MyDeckClient {...base} activeDecks={[deck]} availableDecks={[]} billing={billing} />
  )
  expect(screen.getByText('체험 중')).toBeInTheDocument()
  expect(screen.getByText(/체험 종료일:.*2026년 11월 20일/)).toBeInTheDocument()
  unmount()
  render(<MyDeckClient {...base} billing={billing} />)
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 추가 확인 열기' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('2026년 11월 20일')
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '다시 추가해도 체험 기간은 연장되지 않습니다'
  )
})
test.each([
  ['EXEMPT', '면제 이용 중'],
  ['SUBSCRIBED', '유료 구독 중'],
  ['PAUSED', '결제 준비 중 (무료)'],
])('%s 이용 상태를 체험으로 오인하지 않게 표시한다', (reason, label) => {
  render(
    <MyDeckClient
      {...base}
      activeDecks={[deck]}
      availableDecks={[]}
      billing={[{ ...bill, reason: reason as 'EXEMPT', trialEndsAt: '2026-01-01T00:00:00Z' }]}
    />
  )
  expect(screen.getByText(label)).toBeInTheDocument()
  expect(screen.queryByText('체험 중')).not.toBeInTheDocument()
})
test('만료된 체험은 신규 체험 대신 유료 구독 확인을 표시한다', () => {
  render(
    <MyDeckClient
      {...base}
      billing={[{ ...bill, allowed: false, reason: 'LOCKED', trialEndsAt: '2026-01-01T00:00:00Z' }]}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 추가 확인 열기' }))
  expect(screen.queryByRole('button', { name: '무료 체험 시작' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog')).toHaveTextContent('카드')
})

const inDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString()

test('체험 중 업무에 D-Day 와 구독하기를 보이고, 누르면 구독 예약 확인을 연다', () => {
  render(
    <MyDeckClient
      {...base}
      cardSummary="신한 1234"
      activeDecks={[deck]}
      availableDecks={[]}
      billing={[{ ...bill, reason: 'TRIAL', trialEndsAt: inDays(10) }]}
    />
  )
  expect(screen.getByText(/^D-\d+$/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 유료 구독하기' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('구독을 예약할까요?')
  expect(dialog).toHaveTextContent('오늘 결제 금액')
  expect(screen.getByRole('button', { name: '구독 예약' })).toBeInTheDocument()
})

test('체험 종료 3일 이내면 종료 임박으로 강조한다', () => {
  render(
    <MyDeckClient
      {...base}
      activeDecks={[deck]}
      availableDecks={[]}
      billing={[{ ...bill, reason: 'TRIAL', trialEndsAt: inDays(1) }]}
    />
  )
  expect(screen.getByText(/체험 종료 임박 · D-/)).toBeInTheDocument()
})

test('결제 일시 중지 중에는 구독하기를 비활성화한다', () => {
  render(
    <MyDeckClient
      {...base}
      checkoutPaused
      activeDecks={[deck]}
      availableDecks={[]}
      billing={[{ ...bill, reason: 'TRIAL', trialEndsAt: inDays(10) }]}
    />
  )
  expect(screen.getByRole('button', { name: '모집 관리 유료 구독하기' })).toBeDisabled()
  expect(screen.getByText('결제 준비 중')).toBeInTheDocument()
})

test('구독 예약한 업무는 예약 표시와 예약 취소만 보인다', () => {
  render(
    <MyDeckClient
      {...base}
      activeDecks={[deck]}
      availableDecks={[]}
      subscribedDeckIds={['recruiting']}
      reservedDeckIds={['recruiting']}
      billing={[{ ...bill, reason: 'SUBSCRIBED', trialEndsAt: inDays(10) }]}
    />
  )
  expect(screen.getByText('구독 예약')).toBeInTheDocument()
  expect(screen.getByText(/후 유료 전환/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '모집 관리 유료 구독하기' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 구독 예약 취소 확인 열기' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('결제되지 않으며')
})
