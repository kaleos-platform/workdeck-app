/** @jest-environment node */
jest.mock('next/headers', () => ({ cookies: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { upsert: jest.fn() },
    $transaction: jest.fn(),
  },
}))
import { prisma } from '@/lib/prisma'
import { ensureWorkspaceForUser } from '../workspace'

// 어드민이 두 번째 OWNER Space 를 만든 뒤에도 기존 Workspace.spaceId 연결이 유지되는지(연결은 spaceId 가 빌 때만 채운다).
it('이미 연결된 Workspace 는 두 번째 OWNER Space 가 생겨도 spaceId 를 덮어쓰지 않는다', async () => {
  const tx = {
    $executeRaw: jest.fn(),
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ id: 'w1', name: '기존' }),
      create: jest.fn(),
      // 이미 spaceId 가 있으면 where { spaceId: null } 에 걸리는 행이 없다.
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    spaceMember: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: 'm1' })
        .mockResolvedValueOnce({ spaceId: 'sp-new' }),
    },
    space: { create: jest.fn() },
  }
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx))

  const result = await ensureWorkspaceForUser({ id: 'u1', email: 'a@b.co' })

  expect(result).toEqual({ workspace: { id: 'w1', name: '기존' }, created: false })
  expect(tx.space.create).not.toHaveBeenCalled()
  expect(tx.workspace.updateMany).toHaveBeenCalledWith({
    where: { id: 'w1', spaceId: null },
    data: { spaceId: 'sp-new' },
  })
})
