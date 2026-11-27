/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getUser } from '@/hooks/use-user'
import { resolveRequestedSpaceContext } from '@/lib/api-helpers'
import { checkRateLimit } from '@/lib/hiring/applications'
import {
  assertFeedbackBucket,
  removeFeedbackFiles,
  uploadFeedbackFile,
} from '@/lib/feedback/storage'
import { notifyFeedbackSlack } from '@/lib/feedback/notify'

jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: (fn: () => unknown) => void fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    userFeedback: { create: jest.fn(), delete: jest.fn() },
    userFeedbackAttachment: { aggregate: jest.fn(), createMany: jest.fn() },
    feedbackFileDeletion: { aggregate: jest.fn(), create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (message: string, status: number) =>
    jest.requireActual('next/server').NextResponse.json({ message }, { status }),
  resolveRequestedSpaceContext: jest.fn(),
}))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: jest.fn(() => true) }))
jest.mock('@/lib/feedback/storage', () => ({
  uploadFeedbackFile: jest.fn(async () => undefined),
  removeFeedbackFiles: jest.fn(async (p: string[]) => ({ removed: p, failed: [] })),
  assertFeedbackBucket: jest.fn(async () => undefined),
}))
jest.mock('@/lib/feedback/notify', () => ({ notifyFeedbackSlack: jest.fn(async () => undefined) }))

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const pngFile = (name = 'a.png', extra = 0) => {
  const b = new Uint8Array(PNG.length + extra)
  b.set(PNG)
  return new File([b], name, { type: 'image/png' })
}
function post(fields: Record<string, string> = {}, files: File[] = []) {
  const fd = new FormData()
  fd.set('type', 'BUG')
  fd.set('body', '안녕')
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  for (const f of files) fd.append('files', f)
  return POST(new NextRequest('http://localhost/api/feedback', { method: 'POST', body: fd }))
}
const p = prisma as unknown as Record<string, Record<string, jest.Mock>> & {
  $transaction: jest.Mock
}
const MB = 1024 * 1024

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FEEDBACK_STORAGE_CAP_MB
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'u1', email: 'u@x.com' })
  ;(resolveRequestedSpaceContext as jest.Mock).mockResolvedValue({
    user: { id: 'u1' },
    space: { id: 's1', name: '공간' },
    role: 'OWNER',
  })
  ;(checkRateLimit as jest.Mock).mockReturnValue(true)
  p.userFeedback.create.mockResolvedValue({ id: 'fb1' })
  p.userFeedbackAttachment.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } })
  p.feedbackFileDeletion.aggregate.mockResolvedValue({ _sum: { bytes: 0 } })
  p.feedbackFileDeletion.create.mockResolvedValue({ id: 'led1' })
  p.feedbackFileDeletion.delete.mockResolvedValue({})
  p.userFeedback.delete.mockResolvedValue({})
  p.userFeedbackAttachment.createMany.mockResolvedValue({ count: 0 })
  p.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops))
})

describe('POST /api/feedback', () => {
  it('비로그인 401', async () => {
    ;(getUser as jest.Mock).mockResolvedValue(null)
    expect((await post()).status).toBe(401)
  })
  it('잘못된 type·빈 본문 400', async () => {
    expect((await post({ type: 'NOPE' })).status).toBe(400)
    expect((await post({ body: '   ' })).status).toBe(400)
  })
  it('4장 400, 1MiB+1 413, 매직바이트 불일치 400', async () => {
    expect((await post({}, [pngFile(), pngFile(), pngFile(), pngFile()])).status).toBe(400)
    expect((await post({}, [pngFile('a.png', 1_048_576)])).status).toBe(413)
    const bad = new File([new Uint8Array(20)], 'a.png', { type: 'image/png' })
    expect((await post({}, [bad])).status).toBe(400)
  })
  it('rate limit 429, 키 feedback:userId', async () => {
    ;(checkRateLimit as jest.Mock).mockReturnValue(false)
    expect((await post()).status).toBe(429)
    expect(checkRateLimit).toHaveBeenCalledWith('feedback:u1')
  })
  it('작업 공간 없음(404) → 201 spaceId null', async () => {
    ;(resolveRequestedSpaceContext as jest.Mock).mockResolvedValue({
      error: NextResponse.json({}, { status: 404 }),
    })
    expect((await post()).status).toBe(201)
    expect(p.userFeedback.create.mock.calls[0][0].data.spaceId).toBeNull()
  })
  it('공간 불일치(409) → 201 spaceId null', async () => {
    ;(resolveRequestedSpaceContext as jest.Mock).mockResolvedValue({
      error: NextResponse.json({}, { status: 409 }),
    })
    expect((await post()).status).toBe(201)
    expect(p.userFeedback.create.mock.calls[0][0].data.spaceId).toBeNull()
  })
  it('비구성원 403 그대로', async () => {
    ;(resolveRequestedSpaceContext as jest.Mock).mockResolvedValue({
      error: NextResponse.json({}, { status: 403 }),
    })
    expect((await post()).status).toBe(403)
    expect(p.userFeedback.create).not.toHaveBeenCalled()
  })
  it('상한 초과 → 본문만 저장, attachmentsAccepted false', async () => {
    process.env.FEEDBACK_STORAGE_CAP_MB = '500'
    p.userFeedbackAttachment.aggregate.mockResolvedValue({ _sum: { sizeBytes: 499 * MB } })
    const res = await post({}, [pngFile('a.png', MB - 20), pngFile('b.png', MB - 20)])
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'fb1',
      attachmentsAccepted: false,
      attachmentReason: 'cap',
    })
    expect(uploadFeedbackFile).not.toHaveBeenCalled()
    expect(assertFeedbackBucket).not.toHaveBeenCalled()
    expect(p.userFeedbackAttachment.createMany).not.toHaveBeenCalled()
    expect((notifyFeedbackSlack as jest.Mock).mock.calls[0][0].capReached).toBe(true)
  })
  it('정상 2장: 원장 선기록 → 업로드 → 한 transaction', async () => {
    const order: string[] = []
    p.feedbackFileDeletion.create.mockImplementation(
      async () => (order.push('ledger'), { id: 'led1' })
    )
    ;(uploadFeedbackFile as jest.Mock).mockImplementation(async () => void order.push('upload'))
    const res = await post({ userId: 'evil', spaceId: 'evil' }, [
      pngFile('내사진.png'),
      pngFile('b.png'),
    ])
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'fb1',
      attachmentsAccepted: true,
      attachmentReason: null,
    })
    expect(order).toEqual(['ledger', 'upload', 'upload'])
    const paths = (uploadFeedbackFile as jest.Mock).mock.calls.map((c) => c[0])
    paths.forEach((x: string) => expect(x).toMatch(/^fb1\/[0-9a-f-]{36}\.png$/))
    expect(p.feedbackFileDeletion.create.mock.calls[0][0].data.paths).toEqual(paths)
    expect(p.userFeedbackAttachment.createMany.mock.calls[0][0].data).toHaveLength(2)
    expect(p.feedbackFileDeletion.delete).toHaveBeenCalledWith({ where: { id: 'led1' } })
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    const data = p.userFeedback.create.mock.calls[0][0].data
    expect(data.userId).toBe('u1')
    expect(data.spaceId).toBe('s1')
  })
  it('업로드 실패 → 정리 성공 시 원장·의견 삭제, 500', async () => {
    ;(uploadFeedbackFile as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('x'))
    const res = await post({}, [pngFile(), pngFile('b.png')])
    expect(res.status).toBe(500)
    expect(removeFeedbackFiles).toHaveBeenCalledTimes(1)
    expect(p.feedbackFileDeletion.delete).toHaveBeenCalledWith({ where: { id: 'led1' } })
    expect(p.userFeedback.delete).toHaveBeenCalledWith({ where: { id: 'fb1' } })
  })
  it('업로드 실패 + 정리 실패 → 원장 유지', async () => {
    ;(uploadFeedbackFile as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('x'))
    ;(removeFeedbackFiles as jest.Mock).mockResolvedValueOnce({ removed: [], failed: ['a'] })
    const res = await post({}, [pngFile(), pngFile('b.png')])
    expect(res.status).toBe(500)
    expect(p.feedbackFileDeletion.delete).not.toHaveBeenCalled()
    expect(p.userFeedback.delete).toHaveBeenCalled()
  })
  it('원장 예약 실패 → 의견 행 삭제, 500, 업로드 없음', async () => {
    p.feedbackFileDeletion.create.mockRejectedValueOnce(new Error('db'))
    const res = await post({}, [pngFile()])
    expect(res.status).toBe(500)
    expect(p.userFeedback.delete).toHaveBeenCalledWith({ where: { id: 'fb1' } })
    expect(uploadFeedbackFile).not.toHaveBeenCalled()
  })
  it('버킷 검증 실패 → 503, 업로드 없음', async () => {
    ;(assertFeedbackBucket as jest.Mock).mockRejectedValueOnce(new Error('public'))
    expect((await post({}, [pngFile()])).status).toBe(503)
    expect(uploadFeedbackFile).not.toHaveBeenCalled()
  })
  it('pagePath 무효면 null로 저장', async () => {
    expect((await post({ pagePath: 'not-a-path' })).status).toBe(201)
    expect(p.userFeedback.create.mock.calls[0][0].data.pagePath).toBeNull()
  })
})
