import { notifyAutoReconciliation, notifyWorkerDown } from '@/lib/slack-inventory-notifier'
import { sendSystemNotification } from '@/lib/slack/send-notification'

jest.mock('@/lib/slack/send-notification', () => ({
  sendSystemNotification: jest.fn().mockResolvedValue(true),
  sendDeckNotification: jest.fn(),
}))
const send = sendSystemNotification as unknown as jest.Mock

beforeEach(() => send.mockClear())

test('자동 재고 대조 알림은 그 Space 채널로 보낸다(고객별 알림)', async () => {
  await notifyAutoReconciliation({
    spaceId: 'space-customer',
    snapshotDate: new Date('2026-11-12'),
    issues: [{ kind: 'file-only', count: 3 }],
  })
  expect(send.mock.calls[0][0].spaceId).toBe('space-customer')
})

test('워커 다운은 플랫폼 알림 — spaceId 없이(운영 Space 로만) 보낸다', async () => {
  await notifyWorkerDown({
    service: 'sales-content-worker',
    lastPingAt: null,
    thresholdMinutes: 10,
  })
  expect(send.mock.calls[0][0].spaceId).toBeUndefined()
})
