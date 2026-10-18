/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findFirst: jest.fn() },
    invStorageLocation: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { ensureCoupangLocation } from '../coupang-channel-pairing'

const m = prisma as unknown as {
  workspace: { findFirst: jest.Mock }
  invStorageLocation: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock }
}

beforeEach(() => {
  jest.resetAllMocks()
  m.invStorageLocation.create.mockResolvedValue({ id: 'loc-new' })
})

test('그 Space 에 연결된 워크스페이스만 키로 남긴다', async () => {
  m.workspace.findFirst.mockResolvedValue({ id: 'ws-space' })
  m.invStorageLocation.findFirst.mockResolvedValue({ id: 'loc', externalIntegrationKey: null })
  await ensureCoupangLocation('sp-1', 'ws-space')
  expect(m.workspace.findFirst).toHaveBeenCalledWith({
    where: { id: 'ws-space', spaceId: 'sp-1' },
    select: { id: true },
  })
  expect(m.invStorageLocation.update).toHaveBeenCalledWith({
    where: { id: 'loc' },
    data: { externalIntegrationKey: 'ws-space' },
  })
})

test('다른 Space·미연결 워크스페이스(구성원 본인 소유)는 키로 남기지 않는다', async () => {
  m.workspace.findFirst.mockResolvedValue(null)
  m.invStorageLocation.findFirst.mockResolvedValue({ id: 'loc', externalIntegrationKey: null })
  await ensureCoupangLocation('sp-1', 'ws-member')
  expect(m.invStorageLocation.update).not.toHaveBeenCalled()

  m.invStorageLocation.findFirst.mockResolvedValue(null)
  await ensureCoupangLocation('sp-1', 'ws-member')
  expect(m.invStorageLocation.create.mock.calls[0][0].data.externalIntegrationKey).toBeNull()
})
