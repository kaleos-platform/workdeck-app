/** @jest-environment node */
import { NextResponse } from 'next/server'
import { GET, DELETE } from '../route'
import { prisma } from '@/lib/prisma'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { assertFeedbackBucket, removeFeedbackFiles, signFeedbackFile } from '@/lib/feedback/storage'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/feedback/storage', () => ({
  assertFeedbackBucket: jest.fn(),
  removeFeedbackFiles: jest.fn(),
  signFeedbackFile: jest.fn(),
}))
jest.mock('@/lib/prisma', () => {
  const p = {
    userFeedback: { findUnique: jest.fn() },
    userFeedbackAttachment: { findMany: jest.fn(), updateMany: jest.fn() },
    feedbackFileDeletion: { create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

const ctx = { params: Promise.resolve({ id: 'f1' }) }
const req = (method: string) => new Request('https://admin.test/x', { method })
const rows = [
  { id: 'a1', path: 'p/1', mimeType: 'image/png', sizeBytes: 10, deletedAt: null },
  {
    id: 'a2',
    path: 'p/2',
    mimeType: 'image/png',
    sizeBytes: 20,
    deletedAt: new Date('2026-11-02'),
  },
  { id: 'a3', path: 'p/3', mimeType: 'image/png', sizeBytes: 30, deletedAt: null },
]

beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(requireOperator)
    .mockResolvedValue({ ok: true, user: { id: 'op', email: 'o@x.com' } } as never)
  jest.mocked(prisma.userFeedback.findUnique).mockResolvedValue({ id: 'f1' } as never)
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue(rows as never)
  jest.mocked(assertFeedbackBucket).mockResolvedValue(undefined)
  jest.mocked(prisma.feedbackFileDeletion.create).mockResolvedValue({ id: 'L1' } as never)
  jest.mocked(prisma.feedbackFileDeletion.delete).mockResolvedValue({} as never)
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
    {
      id: 'a2',
      url: null,
      mimeType: 'image/png',
      sizeBytes: 20,
      deletedAt: '2026-11-02T00:00:00.000Z',
    },
    { id: 'a3', url: 'https://signed/p/3', mimeType: 'image/png', sizeBytes: 30, deletedAt: null },
  ])
  expect(signFeedbackFile).toHaveBeenCalledTimes(2)
  expect(removeFeedbackFiles).not.toHaveBeenCalled()
  expect(prisma.userFeedbackAttachment.updateMany).not.toHaveBeenCalled()
})
const claimed = [
  { path: 'p/1', sizeBytes: 10 },
  { path: 'p/3', sizeBytes: 30 },
]
function mockClaim() {
  jest.mocked(prisma.userFeedbackAttachment.updateMany).mockResolvedValue({ count: 2 } as never)
  jest.mocked(prisma.userFeedbackAttachment.findMany).mockResolvedValue(claimed as never)
}
it('GET: 버킷 검증 실패면 서명하지 않고 url null', async () => {
  jest.mocked(assertFeedbackBucket).mockRejectedValue(new Error('public'))
  const body = await (await GET(req('GET'), ctx)).json()
  expect(body.every((r: { url: unknown }) => r.url === null)).toBe(true)
  expect(signFeedbackFile).not.toHaveBeenCalled()
})
it('DELETE: 한 tx에서 선점+원장+감사 로그, 성공하면 원장 삭제', async () => {
  mockClaim()
  jest.mocked(removeFeedbackFiles).mockResolvedValue({ removed: ['p/1', 'p/3'], failed: [] })
  const res = await DELETE(req('DELETE'), ctx)
  expect(await res.json()).toEqual({ removed: 2, failed: 0 })
  expect(prisma.userFeedbackAttachment.updateMany).toHaveBeenCalledWith({
    where: { feedbackId: 'f1', deletedAt: null },
    data: { deletedAt: expect.any(Date) },
  })
  expect(prisma.feedbackFileDeletion.create).toHaveBeenCalledWith({
    data: { paths: ['p/1', 'p/3'], bytes: 40 },
    select: { id: true },
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op',
    'userFeedback.attachmentsDelete',
    'userFeedback',
    'f1',
    { count: 2 },
    prisma
  )
  expect(prisma.feedbackFileDeletion.delete).toHaveBeenCalledWith({ where: { id: 'L1' } })
})
it('DELETE: 일부 실패면 원장을 남기고 failed를 알린다', async () => {
  mockClaim()
  jest.mocked(removeFeedbackFiles).mockResolvedValue({ removed: ['p/1'], failed: ['p/3'] })
  expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ removed: 1, failed: 1 })
  expect(prisma.feedbackFileDeletion.delete).not.toHaveBeenCalled()
})
it('DELETE: remove가 throw하면 전부 failed, 원장 유지', async () => {
  mockClaim()
  jest.mocked(removeFeedbackFiles).mockRejectedValue(new Error('env'))
  expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ removed: 0, failed: 2 })
  expect(prisma.feedbackFileDeletion.delete).not.toHaveBeenCalled()
})
it('DELETE: 지울 첨부가 없으면 원장·Storage 호출 없음', async () => {
  jest.mocked(prisma.userFeedbackAttachment.updateMany).mockResolvedValue({ count: 0 } as never)
  expect(await (await DELETE(req('DELETE'), ctx)).json()).toEqual({ removed: 0, failed: 0 })
  expect(prisma.feedbackFileDeletion.create).not.toHaveBeenCalled()
  expect(removeFeedbackFiles).not.toHaveBeenCalled()
})
