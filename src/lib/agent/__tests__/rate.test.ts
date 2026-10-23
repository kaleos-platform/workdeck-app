/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: { toolAuditLog: { count: jest.fn() } } }))
import { prisma } from '@/lib/prisma'
import { assertUnderRate, RateLimitedError } from '../rate'

const count = prisma.toolAuditLog.count as jest.Mock
const NOW = new Date('2026-10-23T00:01:00Z')
const opts = { actorId: 'ag1', tools: ['secret_env_issue'], limit: 20, windowMs: 60_000, now: NOW }

beforeEach(() => jest.clearAllMocks())

it('창 안 호출 수가 limit 이상이면 RateLimitedError', async () => {
  count.mockResolvedValue(20)
  const err = await assertUnderRate(opts).catch((e) => e)
  expect(err).toBeInstanceOf(RateLimitedError)
  expect(err.message).toBe('잠시 후 다시 시도하세요')
  expect(count).toHaveBeenCalledWith({
    where: {
      actorId: 'ag1',
      tool: { in: ['secret_env_issue'] },
      createdAt: { gt: new Date('2026-10-23T00:00:00Z') },
    },
  })
})

it('limit 미만이면 통과', async () => {
  count.mockResolvedValue(19)
  await expect(assertUnderRate(opts)).resolves.toBeUndefined()
})
