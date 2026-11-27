/** @jest-environment node */
import { DELETE } from '../route'
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { removeFeedbackFiles } from '@/lib/feedback/storage'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/admin/mfa-status', () => ({ getVerifiedTotpUserIds: jest.fn() }))
jest.mock('@/lib/feedback/storage', () => ({ removeFeedbackFiles: jest.fn() }))
jest.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: jest.fn().mockResolvedValue({ error: null }) } } }),
}))
jest.mock('@/lib/prisma', () => {
  const p = {
    user: { findUnique: jest.fn(), delete: jest.fn() },
    spaceMember: { findMany: jest.fn(), count: jest.fn() },
    reorderPlan: { findMany: jest.fn() },
    hiringPostingPosition: { deleteMany: jest.fn() },
    space: { deleteMany: jest.fn() },
    userFeedbackAttachment: { findMany: jest.fn() },
    feedbackFileDeletion: { create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

const call = () =>
  DELETE(new Request('https://admin.test/api/admin/users/u1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'u1' }),
  })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(requireOperator).mockResolvedValue({ ok: true, user: { id: 'op', email: 'o@x.com' } } as never)
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', email: 'a@b.c', platformRole: 'USER' } as never)
  jest.mocked(prisma.spaceMember.findMany).mockResolvedValue([])
  jest.mocked(prisma.reorderPlan.findMany).mockResolvedValue([])
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue([])
  jest.mocked(prisma.feedbackFileDeletion.create).mockResolvedValue({ id: 'L1' } as never)
})

it('미삭제 첨부가 없으면 원장을 만들지 않는다', async () => {
  expect((await call()).status).toBe(200)
  expect(prisma.feedbackFileDeletion.create).not.toHaveBeenCalled()
  expect(removeFeedbackFiles).not.toHaveBeenCalled()
})
it('첨부가 있으면 user.delete 전에 원장을 만들고 commit 후 삭제·원장 제거', async () => {
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue([
    { path: 'p/1', sizeBytes: 10 },
    { path: 'p/2', sizeBytes: 20 },
  ] as never)
  jest.mocked(removeFeedbackFiles).mockResolvedValue({ removed: ['p/1', 'p/2'], failed: [] })
  expect((await call()).status).toBe(200)
  expect(prisma.userFeedbackAttachment.findMany).toHaveBeenCalledWith({
    where: { feedback: { userId: 'u1' }, deletedAt: null },
    select: { path: true, sizeBytes: true },
  })
  expect(prisma.feedbackFileDeletion.create).toHaveBeenCalledWith({
    data: { paths: ['p/1', 'p/2'], bytes: 30 },
  })
  expect(jest.mocked(prisma.feedbackFileDeletion.create).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(prisma.user.delete).mock.invocationCallOrder[0]
  )
  expect(prisma.feedbackFileDeletion.delete).toHaveBeenCalledWith({ where: { id: 'L1' } })
  expect(writeAuditLog).toHaveBeenCalled()
})
it('파일 삭제 실패해도 탈퇴는 성공하고 원장은 남는다', async () => {
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue([{ path: 'p/1', sizeBytes: 10 }] as never)
  jest.mocked(removeFeedbackFiles).mockResolvedValue({ removed: [], failed: ['p/1'] })
  expect((await call()).status).toBe(200)
  expect(prisma.feedbackFileDeletion.delete).not.toHaveBeenCalled()
})
it('removeFeedbackFiles가 throw해도 탈퇴는 성공', async () => {
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue([{ path: 'p/1', sizeBytes: 10 }] as never)
  jest.mocked(removeFeedbackFiles).mockRejectedValue(new Error('x'))
  expect((await call()).status).toBe(200)
  expect(prisma.feedbackFileDeletion.delete).not.toHaveBeenCalled()
})
