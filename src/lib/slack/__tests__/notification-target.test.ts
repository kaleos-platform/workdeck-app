/**
 * @jest-environment node
 */
import { resolveSlackNotificationTarget, resolveDeckNotifyEnabled } from '../notification-target'

const findUniqueWorkspace = jest.fn()
const findManySpaceMember = jest.fn()
const findUniqueSpaceSlackChannel = jest.fn()
const findUniqueDeckInstance = jest.fn()

jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: (...args: unknown[]) => findUniqueWorkspace(...args) },
    spaceMember: { findMany: (...args: unknown[]) => findManySpaceMember(...args) },
    spaceSlackChannel: {
      findUnique: (...args: unknown[]) => findUniqueSpaceSlackChannel(...args),
    },
    deckInstance: { findUnique: (...args: unknown[]) => findUniqueDeckInstance(...args) },
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

describe('resolveDeckNotifyEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Space 해석은 항상 OWNER Space로 성공하도록 기본 세팅.
    findUniqueWorkspace.mockResolvedValue({ ownerId: 'user1' })
    findManySpaceMember.mockResolvedValue([{ spaceId: 'space1', role: 'OWNER' }])
  })

  it('DeckInstance.slackNotifyEnabled=false면 false', async () => {
    findUniqueDeckInstance.mockResolvedValue({ slackNotifyEnabled: false })

    const result = await resolveDeckNotifyEnabled('ws1', 'coupang-ads')

    expect(result).toBe(false)
    expect(findUniqueDeckInstance).toHaveBeenCalledWith({
      where: { spaceId_deckAppId: { spaceId: 'space1', deckAppId: 'coupang-ads' } },
      select: { slackNotifyEnabled: true },
    })
  })

  it('slackNotifyEnabled=true면 true', async () => {
    findUniqueDeckInstance.mockResolvedValue({ slackNotifyEnabled: true })

    expect(await resolveDeckNotifyEnabled('ws1', 'seller-hub')).toBe(true)
  })

  it('DeckInstance가 없으면 fail-open으로 true', async () => {
    findUniqueDeckInstance.mockResolvedValue(null)

    expect(await resolveDeckNotifyEnabled('ws1', 'coupang-ads')).toBe(true)
  })

  it('Space를 해석할 수 없으면(멤버십 없음) fail-open으로 true', async () => {
    findManySpaceMember.mockResolvedValue([])

    expect(await resolveDeckNotifyEnabled('ws1', 'coupang-ads')).toBe(true)
    expect(findUniqueDeckInstance).not.toHaveBeenCalled()
  })
})
