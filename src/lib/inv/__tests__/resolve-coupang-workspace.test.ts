/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpaceStrict } from '../resolve-coupang-workspace'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { findMany: jest.fn() },
    workspace: { findUnique: jest.fn() },
  },
}))

const mock = prisma as unknown as {
  invStorageLocation: { findMany: jest.Mock }
  workspace: { findUnique: jest.Mock }
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
