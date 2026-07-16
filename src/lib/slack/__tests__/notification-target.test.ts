/**
 * @jest-environment node
 */
import { resolveSlackNotificationTarget } from '../notification-target'

const findUniqueWorkspace = jest.fn()
const findManySpaceMember = jest.fn()
const findUniqueSpaceSlackChannel = jest.fn()

jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: (...args: unknown[]) => findUniqueWorkspace(...args) },
    spaceMember: { findMany: (...args: unknown[]) => findManySpaceMember(...args) },
    spaceSlackChannel: {
      findUnique: (...args: unknown[]) => findUniqueSpaceSlackChannel(...args),
    },
  },
}))

describe('resolveSlackNotificationTarget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('workspace가 없으면 null', async () => {
    findUniqueWorkspace.mockResolvedValue(null)

    const result = await resolveSlackNotificationTarget('ws1')

    expect(result).toBeNull()
    expect(findManySpaceMember).not.toHaveBeenCalled()
  })

  it('owner의 Space 멤버십이 없으면 null', async () => {
    findUniqueWorkspace.mockResolvedValue({ ownerId: 'user1' })
    findManySpaceMember.mockResolvedValue([])

    const result = await resolveSlackNotificationTarget('ws1')

    expect(result).toBeNull()
    expect(findUniqueSpaceSlackChannel).not.toHaveBeenCalled()
  })

  it('notifications 채널이 등록되지 않았으면 null (레거시 폴백 신호)', async () => {
    findUniqueWorkspace.mockResolvedValue({ ownerId: 'user1' })
    findManySpaceMember.mockResolvedValue([{ spaceId: 'space1', role: 'OWNER' }])
    findUniqueSpaceSlackChannel.mockResolvedValue(null)

    const result = await resolveSlackNotificationTarget('ws1')

    expect(result).toBeNull()
    expect(findUniqueSpaceSlackChannel).toHaveBeenCalledWith({
      where: { spaceId_kind: { spaceId: 'space1', kind: 'notifications' } },
      select: expect.anything(),
    })
  })

  it('여러 멤버십 중 OWNER 역할을 우선한다', async () => {
    findUniqueWorkspace.mockResolvedValue({ ownerId: 'user1' })
    findManySpaceMember.mockResolvedValue([
      { spaceId: 'space-member', role: 'MEMBER' },
      { spaceId: 'space-owner', role: 'OWNER' },
    ])
    findUniqueSpaceSlackChannel.mockResolvedValue({
      channelId: 'C123',
      installation: { botToken: 'enc', botTokenIv: 'iv' },
    })

    const result = await resolveSlackNotificationTarget('ws1')

    expect(findUniqueSpaceSlackChannel).toHaveBeenCalledWith({
      where: { spaceId_kind: { spaceId: 'space-owner', kind: 'notifications' } },
      select: expect.anything(),
    })
    expect(result).toEqual({
      spaceId: 'space-owner',
      channelId: 'C123',
      botToken: 'enc',
      botTokenIv: 'iv',
    })
  })

  it('OWNER 역할이 없으면 첫 번째(최고참) 멤버십을 사용한다', async () => {
    findUniqueWorkspace.mockResolvedValue({ ownerId: 'user1' })
    findManySpaceMember.mockResolvedValue([{ spaceId: 'space-first', role: 'MEMBER' }])
    findUniqueSpaceSlackChannel.mockResolvedValue({
      channelId: 'C999',
      installation: { botToken: 'enc2', botTokenIv: 'iv2' },
    })

    const result = await resolveSlackNotificationTarget('ws1')

    expect(result?.spaceId).toBe('space-first')
  })
})
