/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn() },
    spaceMember: { findFirst: jest.fn() },
    billingDeckProduct: { findUnique: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { canWorkspaceCollect } from '../entitlement'

const p = prisma as unknown as {
  workspace: { findUnique: jest.Mock }
  spaceMember: { findFirst: jest.Mock }
  billingDeckProduct: { findUnique: jest.Mock }
}

describe('canWorkspaceCollect', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 과금 카탈로그에 없으면 canUseDeck=true — 판정 축(어떤 spaceId로 물었는지)만 검증한다.
    p.billingDeckProduct.findUnique.mockResolvedValue(null)
  })

  it('spaceId FK가 있으면 멤버십 역참조를 하지 않는다', async () => {
    p.workspace.findUnique.mockResolvedValue({ ownerId: 'u1', spaceId: 'space-fk' })
    await expect(canWorkspaceCollect('ws1')).resolves.toBe(true)
    expect(p.spaceMember.findFirst).not.toHaveBeenCalled()
  })

  it('unlinked workspace → false — 멤버십이 있어도 다른 Space의 구독으로 판정하지 않는다', async () => {
    p.workspace.findUnique.mockResolvedValue({ spaceId: null })
    p.spaceMember.findFirst.mockResolvedValue({ spaceId: 'space-old' })
    await expect(canWorkspaceCollect('ws1')).resolves.toBe(false)
    expect(p.spaceMember.findFirst).not.toHaveBeenCalled()
    expect(p.billingDeckProduct.findUnique).not.toHaveBeenCalled()
  })

  it('Workspace가 없으면 false', async () => {
    p.workspace.findUnique.mockResolvedValue(null)
    await expect(canWorkspaceCollect('ws1')).resolves.toBe(false)
  })
})
