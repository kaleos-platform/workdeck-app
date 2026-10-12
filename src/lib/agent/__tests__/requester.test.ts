/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: { spaceMember: { findFirst: jest.fn() } } }))
import { prisma } from '@/lib/prisma'
import { resolveRequester } from '../requester'

const findFirst = prisma.spaceMember.findFirst as jest.Mock

describe('resolveRequester', () => {
  beforeEach(() => jest.clearAllMocks())
  it('연결된 Slack 사용자 → 같은 Space 구성원 User.id', async () => {
    findFirst.mockResolvedValue({ userId: 'u-bit' })
    await expect(resolveRequester('sp1', 'U123')).resolves.toEqual({
      requesterUserId: 'u-bit',
      requesterSlackUserId: 'U123',
    })
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'sp1', slackUserId: 'U123' } })
    )
  })
  it('unlinked slack user → null, 원문 ID는 남긴다', async () => {
    findFirst.mockResolvedValue(null)
    await expect(resolveRequester('sp1', 'U999')).resolves.toEqual({
      requesterUserId: null,
      requesterSlackUserId: 'U999',
    })
  })
  it('형식이 틀린 ID는 조회하지 않는다', async () => {
    await expect(resolveRequester('sp1', 'not-slack')).resolves.toEqual({
      requesterUserId: null,
      requesterSlackUserId: null,
    })
    expect(findFirst).not.toHaveBeenCalled()
  })
})
