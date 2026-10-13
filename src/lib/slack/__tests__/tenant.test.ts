/** @jest-environment node */
jest.mock('@/lib/prisma', () => {
  const p = {
    slackInstallation: { findMany: jest.fn(), findUnique: jest.fn() },
    spaceSlackChannel: { findFirst: jest.fn(), upsert: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  }
  // 트랜잭션 콜백에 같은 mock을 tx로 넘긴다.
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

import { prisma } from '@/lib/prisma'
import {
  findChannelOwnedByOtherSpace,
  findTeamInstallationForSpace,
  isChannelRegisteredToSpace,
  registerSpaceChannel,
  resolveEventSpace,
} from '../tenant'

const p = prisma as unknown as {
  slackInstallation: { findMany: jest.Mock; findUnique: jest.Mock }
  spaceSlackChannel: { findFirst: jest.Mock; upsert: jest.Mock }
  $executeRaw: jest.Mock
}
const inst = (spaceId: string) => ({
  spaceId,
  botToken: `enc-${spaceId}`,
  botTokenIv: 'v1',
  botUserId: 'UBOT',
})

beforeEach(() => jest.clearAllMocks())

describe('resolveEventSpace', () => {
  it('설치 없음 → not_installed', async () => {
    p.slackInstallation.findMany.mockResolvedValue([])
    await expect(resolveEventSpace('T1', 'CX')).resolves.toEqual({ status: 'not_installed' })
  })

  it('설치 1개 + 미등록 채널 → unmapped(Space 없음)', async () => {
    p.slackInstallation.findMany.mockResolvedValue([inst('sp1')])
    p.spaceSlackChannel.findFirst.mockResolvedValue(null)
    const r = await resolveEventSpace('T1', 'C_ANY')
    expect(r).toEqual({ status: 'unmapped', botToken: 'enc-sp1', botTokenIv: 'v1' })
    expect(r).not.toHaveProperty('installation')
  })

  it('설치 1개 + 등록 채널 → 그 Space', async () => {
    p.slackInstallation.findMany.mockResolvedValue([inst('sp1')])
    p.spaceSlackChannel.findFirst.mockResolvedValue({ spaceId: 'sp1' })
    await expect(resolveEventSpace('T1', 'CX')).resolves.toEqual({
      status: 'routed',
      installation: inst('sp1'),
    })
    expect(p.spaceSlackChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: 'CX', spaceId: { in: ['sp1'] } } })
    )
  })

  it('같은 team 두 Space: 채널 X → Space1, Y → Space2', async () => {
    p.slackInstallation.findMany.mockResolvedValue([inst('sp1'), inst('sp2')])
    p.spaceSlackChannel.findFirst
      .mockResolvedValueOnce({ spaceId: 'sp1' })
      .mockResolvedValueOnce({ spaceId: 'sp2' })
    await expect(resolveEventSpace('T1', 'CX')).resolves.toEqual({
      status: 'routed',
      installation: inst('sp1'),
    })
    await expect(resolveEventSpace('T1', 'CY')).resolves.toEqual({
      status: 'routed',
      installation: inst('sp2'),
    })
    expect(p.spaceSlackChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: 'CX', spaceId: { in: ['sp1', 'sp2'] } } })
    )
  })

  it('같은 team 두 Space + 등록 안 된 채널 → unmapped(spaceId를 주지 않는다)', async () => {
    p.slackInstallation.findMany.mockResolvedValue([inst('sp1'), inst('sp2')])
    p.spaceSlackChannel.findFirst.mockResolvedValue(null)
    const r = await resolveEventSpace('T1', 'CZ')
    expect(r).toEqual({ status: 'unmapped', botToken: 'enc-sp1', botTokenIv: 'v1' })
    expect(r).not.toHaveProperty('installation')
  })
})

describe('findTeamInstallationForSpace', () => {
  it('pending Space의 설치가 같은 team이면 반환', async () => {
    p.slackInstallation.findUnique.mockResolvedValue({
      teamId: 'T1',
      botToken: 'e',
      botTokenIv: 'v1',
    })
    await expect(findTeamInstallationForSpace('sp1', 'T1')).resolves.toEqual({
      teamId: 'T1',
      botToken: 'e',
      botTokenIv: 'v1',
    })
    expect(p.slackInstallation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'sp1' } })
    )
  })

  it('다른 team이거나 설치 없음 → null', async () => {
    p.slackInstallation.findUnique.mockResolvedValueOnce({
      teamId: 'T2',
      botToken: 'e',
      botTokenIv: 'v1',
    })
    await expect(findTeamInstallationForSpace('sp1', 'T1')).resolves.toBeNull()
    p.slackInstallation.findUnique.mockResolvedValueOnce(null)
    await expect(findTeamInstallationForSpace('sp1', 'T1')).resolves.toBeNull()
  })
})

describe('findChannelOwnedByOtherSpace', () => {
  it('같은 team의 다른 Space가 등록한 채널이면 true', async () => {
    p.spaceSlackChannel.findFirst.mockResolvedValue({ id: 'ch1' })
    await expect(
      findChannelOwnedByOtherSpace({ teamId: 'T1', channelId: 'CX', spaceId: 'sp2' })
    ).resolves.toBe(true)
    expect(p.spaceSlackChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'CX', spaceId: { not: 'sp2' }, installation: { teamId: 'T1' } },
      })
    )
  })

  it('없으면 false', async () => {
    p.spaceSlackChannel.findFirst.mockResolvedValue(null)
    await expect(
      findChannelOwnedByOtherSpace({ teamId: 'T1', channelId: 'CX', spaceId: 'sp1' })
    ).resolves.toBe(false)
  })
})

describe('isChannelRegisteredToSpace', () => {
  it('자기 Space가 현재 team으로 등록한 채널만 true', async () => {
    p.spaceSlackChannel.findFirst.mockResolvedValue({ id: 'ch1' })
    await expect(
      isChannelRegisteredToSpace({ teamId: 'T1', channelId: 'CX', spaceId: 'sp1' })
    ).resolves.toBe(true)
    expect(p.spaceSlackChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'CX', spaceId: 'sp1', installation: { teamId: 'T1' } },
      })
    )
    p.spaceSlackChannel.findFirst.mockResolvedValue(null)
    await expect(
      isChannelRegisteredToSpace({ teamId: 'T1', channelId: 'CX', spaceId: 'sp1' })
    ).resolves.toBe(false)
  })
})

describe('registerSpaceChannel', () => {
  const input = { spaceId: 'sp2', channelId: 'CX', channelName: null, kind: 'approvals' }
  beforeEach(() => p.slackInstallation.findUnique.mockResolvedValue({ teamId: 'T1' }))

  it('Space lock → teamId 재조회 → 채널 lock 순서, 다른 Space 소유면 upsert하지 않는다', async () => {
    p.spaceSlackChannel.findFirst.mockResolvedValue({ id: 'other' })
    await expect(registerSpaceChannel(input)).resolves.toEqual({ ok: false, reason: 'taken' })
    expect(p.$executeRaw).toHaveBeenCalledTimes(2)
    const [spaceLock, channelLock] = p.$executeRaw.mock.invocationCallOrder
    const teamRead = p.slackInstallation.findUnique.mock.invocationCallOrder[0]
    expect(spaceLock).toBeLessThan(teamRead)
    expect(teamRead).toBeLessThan(channelLock)
    expect(channelLock).toBeLessThan(p.spaceSlackChannel.findFirst.mock.invocationCallOrder[0])
    expect(p.slackInstallation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'sp2' } })
    )
    expect(p.spaceSlackChannel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ installation: { teamId: 'T1' } }),
      })
    )
    expect(p.spaceSlackChannel.upsert).not.toHaveBeenCalled()
  })

  it('lock 뒤에 설치가 없으면 not_installed, 등록하지 않는다', async () => {
    p.slackInstallation.findUnique.mockResolvedValue(null)
    await expect(registerSpaceChannel(input)).resolves.toEqual({
      ok: false,
      reason: 'not_installed',
    })
    expect(p.spaceSlackChannel.upsert).not.toHaveBeenCalled()
  })

  it('비어 있으면 이 Space의 kind 행으로 upsert', async () => {
    p.spaceSlackChannel.findFirst.mockResolvedValue(null)
    p.spaceSlackChannel.upsert.mockResolvedValue({
      id: 'ch1',
      channelId: 'CX',
      channelName: null,
      kind: 'approvals',
    })
    await expect(registerSpaceChannel(input)).resolves.toEqual({
      ok: true,
      channel: { id: 'ch1', channelId: 'CX', channelName: null, kind: 'approvals' },
    })
    expect(p.spaceSlackChannel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId_kind: { spaceId: 'sp2', kind: 'approvals' } } })
    )
  })
})
