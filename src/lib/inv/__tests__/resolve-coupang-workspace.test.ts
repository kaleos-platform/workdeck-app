/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import {
  resolveCoupangWorkspaceForSpaceStrict,
  resolveSpaceCoupangWorkspaceId,
} from '../resolve-coupang-workspace'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { findMany: jest.fn(), count: jest.fn() },
    workspace: { findUnique: jest.fn(), findFirst: jest.fn() },
  },
}))

const mock = prisma as unknown as {
  invStorageLocation: { findMany: jest.Mock; count: jest.Mock }
  workspace: { findUnique: jest.Mock; findFirst: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()
  mock.workspace.findUnique.mockResolvedValue({ id: 'ws-a' })
})

// 첫 findMany: 이 Space 의 위치, 둘째: 같은 키를 쓰는 다른 Space 의 위치
function locations(own: { id: string; externalIntegrationKey: string | null }[], others = 0) {
  mock.invStorageLocation.findMany
    .mockResolvedValueOnce(own)
    .mockResolvedValueOnce(Array.from({ length: others }, (_, i) => ({ id: `other-${i}` })))
}

describe('resolveCoupangWorkspaceForSpaceStrict', () => {
  test('키가 하나이고 다른 Space 가 쓰지 않으면 해석한다', async () => {
    locations([{ id: 'loc', externalIntegrationKey: 'ws-a' }])
    expect(await resolveCoupangWorkspaceForSpaceStrict('space-a')).toEqual({
      workspaceId: 'ws-a',
      locationId: 'loc',
    })
  })

  test('같은 키를 다른 Space 도 쓰면 null (fail closed)', async () => {
    locations([{ id: 'loc', externalIntegrationKey: 'ws-a' }], 1)
    expect(await resolveCoupangWorkspaceForSpaceStrict('space-a')).toBeNull()
  })

  test('Space 안에서 키가 둘 이상이면 null', async () => {
    locations([
      { id: 'loc1', externalIntegrationKey: 'ws-a' },
      { id: 'loc2', externalIntegrationKey: 'ws-b' },
    ])
    expect(await resolveCoupangWorkspaceForSpaceStrict('space-a')).toBeNull()
  })

  test('위치·키 없음 또는 워크스페이스 삭제 → null', async () => {
    locations([])
    expect(await resolveCoupangWorkspaceForSpaceStrict('space-a')).toBeNull()
    locations([{ id: 'loc', externalIntegrationKey: 'ws-a' }])
    mock.workspace.findUnique.mockResolvedValue(null)
    expect(await resolveCoupangWorkspaceForSpaceStrict('space-a')).toBeNull()
  })
})

describe('resolveSpaceCoupangWorkspaceId', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mock.invStorageLocation.count.mockResolvedValue(0)
  })

  test('엄격 키가 있으면 그 워크스페이스', async () => {
    locations([{ id: 'loc', externalIntegrationKey: 'ws-a' }])
    mock.workspace.findUnique.mockResolvedValue({ id: 'ws-a' })
    expect(await resolveSpaceCoupangWorkspaceId('sp-1', 'u-1')).toBe('ws-a')
  })

  test('키가 있는데 모호하면 null — Space 연결·본인 소유로 새지 않는다', async () => {
    locations([
      { id: 'l1', externalIntegrationKey: 'ws-a' },
      { id: 'l2', externalIntegrationKey: 'ws-b' },
    ])
    mock.invStorageLocation.count.mockResolvedValue(2)
    expect(await resolveSpaceCoupangWorkspaceId('sp-1', 'u-1')).toBeNull()
    expect(mock.workspace.findFirst).not.toHaveBeenCalled()
  })

  test('키가 없으면 Space 연결 워크스페이스, 없으면 다른 Space 에 묶이지 않은 본인 소유', async () => {
    mock.invStorageLocation.findMany.mockResolvedValue([])
    mock.workspace.findUnique.mockResolvedValueOnce({ id: 'ws-linked' })
    expect(await resolveSpaceCoupangWorkspaceId('sp-1', 'u-1')).toBe('ws-linked')

    mock.workspace.findUnique.mockResolvedValueOnce(null)
    mock.workspace.findFirst.mockResolvedValueOnce({ id: 'ws-own' })
    expect(await resolveSpaceCoupangWorkspaceId('sp-1', 'u-1')).toBe('ws-own')
    expect(mock.workspace.findFirst).toHaveBeenCalledWith({
      where: { ownerId: 'u-1', OR: [{ spaceId: null }, { spaceId: 'sp-1' }] },
      select: { id: true },
    })
  })
})
