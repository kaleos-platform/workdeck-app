/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { notifyWorkerTokenExpiring } from '@/lib/slack-inventory-notifier'

jest.mock('@/lib/cron/with-cron-run', () => ({
  withCronRun: (_path: string, handler: (r: unknown) => Promise<Record<string, unknown>>) =>
    handler,
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([]),
    workerHeartbeat: {
      findUnique: jest.fn().mockResolvedValue({ lastPingAt: new Date(), metadata: {} }),
    },
    workerToken: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/slack-inventory-notifier', () => ({
  notifyInventoryStaleData: jest.fn(),
  notifyWorkerDown: jest.fn(),
  notifyWorkerTokenExpiring: jest.fn().mockResolvedValue(true),
}))
const findMany = prisma.workerToken.findMany as unknown as jest.Mock
const notify = notifyWorkerTokenExpiring as unknown as jest.Mock

beforeEach(() => jest.clearAllMocks())

test('최근 쓰인 미폐기 토큰 중 30일 안에 만료되는 것만 조회해 알린다', async () => {
  const now = Date.now()
  const expiresAt = new Date(now + 10 * 86_400_000)
  findMany.mockResolvedValue([
    { id: 't1', name: 'macmini-nbaesong', expiresAt, space: { name: '의식주의' } },
  ])
  const res = await GET(new NextRequest('http://localhost/x'))

  const { where } = findMany.mock.calls[0][0]
  expect(where.revokedAt).toBeNull()
  expect(Math.abs(where.expiresAt.lte.getTime() - (now + 30 * 86_400_000))).toBeLessThan(5_000)
  expect(Math.abs(where.lastUsedAt.gte.getTime() - (now - 7 * 86_400_000))).toBeLessThan(5_000)
  expect(notify).toHaveBeenCalledWith([
    { name: 'macmini-nbaesong', spaceName: '의식주의', expiresAt },
  ])
  expect(res).toMatchObject({ expiringTokens: [{ id: 't1', expiresAt: expiresAt.toISOString() }] })
})

test('대상이 없으면 알리지 않는다', async () => {
  findMany.mockResolvedValue([])
  await GET(new NextRequest('http://localhost/x'))
  expect(notify).not.toHaveBeenCalled()
})
