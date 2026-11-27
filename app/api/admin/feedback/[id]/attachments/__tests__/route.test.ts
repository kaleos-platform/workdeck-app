/** @jest-environment node */
import { NextResponse } from 'next/server'
import { GET, DELETE } from '../route'
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { removeFeedbackFiles, signFeedbackFile } from '@/lib/feedback/storage'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/feedback/storage', () => ({ removeFeedbackFiles: jest.fn(), signFeedbackFile: jest.fn() }))
jest.mock('@/lib/prisma', () => {
  const p = {
    userFeedback: { findUnique: jest.fn() },
    userFeedbackAttachment: { findMany: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

const ctx = { params: Promise.resolve({ id: 'f1' }) }
const req = (method: string) => new Request('https://admin.test/x', { method })
const rows = [
  { id: 'a1', path: 'p/1', mimeType: 'image/png', sizeBytes: 10, deletedAt: null },
  { id: 'a2', path: 'p/2', mimeType: 'image/png', sizeBytes: 20, deletedAt: new Date('2026-11-02') },
  { id: 'a3', path: 'p/3', mimeType: 'image/png', sizeBytes: 30, deletedAt: null },
]

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(requireOperator).mockResolvedValue({ ok: true, user: { id: 'op', email: 'o@x.com' } } as never)
  jest.mocked(prisma.userFeedback.findUnique).mockResolvedValue({ id: 'f1' } as never)
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue(rows as never)
  jest.mocked(signFeedbackFile).mockImplementation(async (p: string) => `https://signed/${p}`)
})

it('비운영자·없는 의견', async () => {
  jest.mocked(requireOperator).mockResolvedValueOnce({
    ok: false,
    reason: 'NOT_OPERATOR',
    response: NextResponse.json({}, { status: 404 }),
  } as never)
  expect((await GET(req('GET'), ctx)).status).toBe(404)
  jest.mocked(prisma.userFeedback.findUnique).mockResolvedValue(null)
  expect((await GET(req('GET'), ctx)).status).toBe(404)
  expect((await DELETE(req('DELETE'), ctx)).status).toBe(404)
})
it('GET은 전체 행을 반환하고 삭제된 행만 url null, 부작용 없음', async () => {
  const res = await GET(req('GET'), ctx)
  expect(await res.json()).toEqual([
    { id: 'a1', url: 'https://signed/p/1', mimeType: 'image/png', sizeBytes: 10, deletedAt: null },
    { id: 'a2', url: null, mimeType: 'image/png', sizeBytes: 20, deletedAt: '2026-11-02T00:00:00.000Z' },
    { id: 'a3', url: 'https://signed/p/3', mimeType: 'image/png', sizeBytes: 30, deletedAt: null },
  ])
  expect(signFeedbackFile).toHaveBeenCalledTimes(2)
  expect(removeFeedbackFiles).not.toHaveBeenCalled()
  expect(prisma.userFeedbackAttachment.updateMany).not.toHaveBeenCalled()
})
it('DELETE는 성공분만 deletedAt을 기록하고 failed를 알린다', async () => {
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue([rows[0], rows[2]] as never)
  jest.mocked(removeFeedbackFiles).mockResolvedValue({ removed: ['p/1'], failed: ['p/3'] })
  const res = await DELETE(req('DELETE'), ctx)
  expect(await res.json()).toEqual({ removed: 1, failed: 1 })
  expect(prisma.userFeedbackAttachment.updateMany).toHaveBeenCalledWith({
    where: { feedbackId: 'f1', path: { in: ['p/1'] }, deletedAt: null },
    data: { deletedAt: expect.any(Date) },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op',
    'userFeedback.attachmentsDelete',
    'userFeedback',
    'f1',
    { removed: 1, failed: 1 },
    prisma
  )
})
