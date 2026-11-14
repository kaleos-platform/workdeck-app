/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getBillingProvider } from '@/lib/billing/providers/toss'
jest.mock('@/lib/prisma', () => ({
  prisma: {
    billingCharge: { findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/billing/providers/toss', () => ({ getBillingProvider: jest.fn() }))
const start = new Date('2026-11-14T00:00:00Z'),
  end = new Date('2026-12-14T00:00:00Z')
const charge = {
  id: 'c',
  spaceId: 's',
  orderId: 'order',
  paymentKey: 'pk',
  provider: 'toss',
  status: 'PAID',
  periodStart: start,
  periodEnd: end,
  breakdown: [{ type: 'DECK', deckAppId: 'recruiting', price: 10000 }],
}
const sub = {
  id: 'sub',
  status: 'ACTIVE',
  currentPeriodEnd: end,
  items: [
    {
      id: 'i',
      deckAppId: 'recruiting',
      type: 'DECK',
      status: 'CANCEL_AT_PERIOD_END',
      addedAt: start,
    },
  ],
}
const tx = {
  $queryRaw: jest.fn(),
  billingCharge: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  spaceSubscription: { findUnique: jest.fn(), update: jest.fn() },
  subscriptionItem: { updateMany: jest.fn(), findMany: jest.fn() },
  spaceDeckAccess: { findMany: jest.fn() },
}
const provider = { id: 'toss', parseWebhook: jest.fn(), fetchPaymentStatus: jest.fn() }
const req = (secret = 'test-secret') =>
  new NextRequest('http://localhost/api/billing/toss/webhook?secret=' + secret, {
    method: 'POST',
    body: JSON.stringify({
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: { orderId: 'order', paymentKey: 'pk', status: 'CANCELED' },
    }),
  })
beforeEach(() => {
  jest.clearAllMocks()
  process.env.TOSS_WEBHOOK_SECRET = 'test-secret'
  jest.mocked(prisma.billingCharge.findUnique).mockResolvedValue(charge as never)
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (fn) => (fn as unknown as (db: typeof tx) => Promise<unknown>)(tx))
  jest.mocked(getBillingProvider).mockReturnValue(provider as never)
  provider.parseWebhook.mockReturnValue({ orderId: 'order', paymentKey: 'pk' })
  provider.fetchPaymentStatus.mockResolvedValue({ orderId: 'order', status: 'CANCELED' })
  tx.billingCharge.findUnique.mockResolvedValue(charge)
  tx.billingCharge.findMany.mockResolvedValue([])
  tx.spaceSubscription.findUnique.mockResolvedValue(sub)
  tx.subscriptionItem.findMany.mockResolvedValue([])
})
test('검증된 전액 취소는 해당 업무를 종료하고 해지 예정일을 제거한다', async () => {
  expect((await POST(req())).status).toBe(200)
  expect(tx.subscriptionItem.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ subscriptionId: 'sub', deckAppId: { in: ['recruiting'] } }),
      data: expect.objectContaining({ status: 'ENDED', lockedPrice: null }),
    })
  )
  expect(tx.spaceSubscription.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELED', currentPeriodEnd: null, retryCount: 0 }),
    })
  )
})
test('이미 환불 처리된 청구도 남아 있는 구독 상태를 복구한다', async () => {
  tx.billingCharge.findUnique.mockResolvedValue({ ...charge, status: 'REFUNDED' })
  expect((await POST(req())).status).toBe(200)
  expect(tx.subscriptionItem.updateMany).toHaveBeenCalled()
})
test('과거 주기 환불은 새 구독을 종료하지 않는다', async () => {
  tx.spaceSubscription.findUnique.mockResolvedValue({
    ...sub,
    currentPeriodEnd: new Date('2027-01-14T00:00:00Z'),
  })
  await POST(req())
  expect(tx.subscriptionItem.updateMany).not.toHaveBeenCalled()
})
test('부분 취소는 전액 환불이나 즉시 구독 종료로 처리하지 않는다', async () => {
  provider.fetchPaymentStatus.mockResolvedValue({ orderId: 'order', status: 'PARTIAL_CANCELED' })
  await POST(req())
  expect(prisma.billingCharge.updateMany).not.toHaveBeenCalled()
  expect(tx.billingCharge.updateMany).not.toHaveBeenCalled()
  expect(tx.subscriptionItem.updateMany).not.toHaveBeenCalled()
})
test('다른 유료 업무가 남으면 전체 구독을 종료하지 않는다', async () => {
  tx.subscriptionItem.findMany.mockResolvedValue([
    { deckAppId: 'finance', status: 'ACTIVE', awaitingTrialEnd: false, addedAt: start },
  ])
  await POST(req())
  expect(tx.subscriptionItem.updateMany).toHaveBeenCalled()
  expect(tx.spaceSubscription.update).not.toHaveBeenCalled()
})
test('체험 예약만 남으면 구독을 끝내지 않고 결제일을 체험 종료일로 맞춘다', async () => {
  const trialEnd = new Date('2026-11-20T00:00:00Z')
  tx.subscriptionItem.findMany.mockResolvedValue([
    { deckAppId: 'finance', status: 'ACTIVE', awaitingTrialEnd: true, addedAt: start },
  ])
  tx.spaceDeckAccess.findMany.mockResolvedValue([{ deckAppId: 'finance', trialEndsAt: trialEnd }])
  await POST(req())
  expect(tx.spaceSubscription.update).toHaveBeenCalledWith({
    where: { id: 'sub' },
    data: { currentPeriodEnd: trialEnd, retryCount: 0 },
  })
})
test('새 결제가 같은 업무의 이용 기간을 보장하면 종료하지 않는다', async () => {
  tx.billingCharge.findMany.mockResolvedValue([
    { ...charge, id: 'new', periodStart: new Date(start.getTime() + 1000) },
  ])
  await POST(req())
  expect(tx.subscriptionItem.updateMany).not.toHaveBeenCalled()
})
test('결제 검증 실패는 재전송 가능한 응답이며 상태를 쓰지 않는다', async () => {
  provider.fetchPaymentStatus.mockRejectedValue(new Error('offline'))
  expect((await POST(req())).status).toBe(502)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
test('서명과 원 주문이 일치하지 않으면 상태를 쓰지 않는다', async () => {
  expect((await POST(req('invalid'))).status).toBe(401)
  provider.fetchPaymentStatus.mockResolvedValue({ orderId: 'different', status: 'CANCELED' })
  await POST(req())
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

test('동일 업무의 결제가 진행 중이면 완료로 응답하지 않고 재검증을 요청한다', async () => {
  tx.billingCharge.findMany.mockResolvedValue([{ ...charge, id: 'pending', status: 'PENDING' }])
  expect((await POST(req())).status).toBe(503)
})

test('다른 업무의 추가 결제 중에도 전체 구독 종료를 보류한다', async () => {
  tx.billingCharge.findMany.mockResolvedValue([
    {
      ...charge,
      id: 'new-deck',
      status: 'PENDING',
      breakdown: [{ type: 'DECK', deckAppId: 'finance', price: 10000 }],
    },
  ])
  expect((await POST(req())).status).toBe(503)
  expect(tx.spaceSubscription.update).not.toHaveBeenCalled()
})
