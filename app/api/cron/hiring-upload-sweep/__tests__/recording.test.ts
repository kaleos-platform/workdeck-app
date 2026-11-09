/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { removeApplicantFiles } from '@/lib/hiring/storage'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    cronRun: { create: jest.fn() },
    hiringUploadSession: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    hiringApplicationFile: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/hiring/storage', () => ({ removeApplicantFiles: jest.fn() }))

const id = '00000000-0000-4000-8000-000000000001'
const fileId = '00000000-0000-4000-8000-000000000002'
const secret = 'test-secret'

beforeEach(() => {
  jest.resetAllMocks()
  process.env.CRON_SECRET = secret
  ;(prisma.hiringUploadSession.findMany as jest.Mock)
    .mockResolvedValueOnce([
      {
        id,
        spaceId: 'space',
        files: [
          {
            id: fileId,
            fieldKey: 'resume',
            fileName: 'synthetic.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 10,
            path: `space/applications/${id}/${fileId}.pdf`,
          },
        ],
      },
    ])
    .mockResolvedValue([])
  ;(prisma.hiringUploadSession.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.hiringApplicationFile.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma))
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

it('부분 실패는 HTTP 200과 집계를 유지하면서 실패 이력으로 남긴다', async () => {
  ;(removeApplicantFiles as jest.Mock).mockRejectedValue(new Error('private storage error'))
  const response = await GET(
    new NextRequest('http://localhost/api/cron/hiring-upload-sweep', {
      headers: { authorization: `Bearer ${secret}` },
    })
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    scanned: 1,
    deleted: 0,
    failed: 1,
    remaining: 0,
    truncated: false,
  })
  expect(prisma.cronRun.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      ok: false,
      error: null,
      detail: { scanned: 1, deleted: 0, failed: 1, remaining: 0, truncated: false },
    }),
  })
  expect(prisma.hiringUploadSession.delete).not.toHaveBeenCalled()
})

it('실패가 없으면 성공 이력을 남긴다', async () => {
  const response = await GET(
    new NextRequest('http://localhost/api/cron/hiring-upload-sweep', {
      headers: { authorization: `Bearer ${secret}` },
    })
  )
  expect(response.status).toBe(200)
  expect(prisma.cronRun.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ ok: true, detail: expect.objectContaining({ failed: 0 }) }),
  })
})

it('인증되지 않은 요청은 실행하거나 이력을 남기지 않는다', async () => {
  const response = await GET(new NextRequest('http://localhost/api/cron/hiring-upload-sweep'))
  expect(response.status).toBe(401)
  expect(prisma.hiringUploadSession.findMany).not.toHaveBeenCalled()
  expect(prisma.cronRun.create).not.toHaveBeenCalled()
})

it('backoff 갱신까지 실패하면 후속 항목 처리 없이 HTTP 500을 반환한다', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    ;(removeApplicantFiles as jest.Mock).mockRejectedValue(new Error('storage failure'))
    ;(prisma.hiringUploadSession.updateMany as jest.Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('backoff failure'))
    const response = await GET(
      new NextRequest('http://localhost/api/cron/hiring-upload-sweep', {
        headers: { authorization: `Bearer ${secret}` },
      })
    )
    expect(response.status).toBe(500)
    expect(prisma.hiringUploadSession.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.hiringUploadSession.delete).not.toHaveBeenCalled()
    expect(prisma.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ok: false, error: 'backoff failure' }),
    })
  } finally {
    log.mockRestore()
  }
})

it('부분 실패 이력 저장이 실패해도 HTTP 200과 집계를 유지한다', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    ;(removeApplicantFiles as jest.Mock).mockRejectedValue(new Error('storage failure'))
    ;(prisma.cronRun.create as jest.Mock).mockRejectedValue(new Error('db unavailable'))
    const response = await GET(
      new NextRequest('http://localhost/api/cron/hiring-upload-sweep', {
        headers: { authorization: `Bearer ${secret}` },
      })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      scanned: 1,
      deleted: 0,
      failed: 1,
      remaining: 0,
      truncated: false,
    })
    expect(prisma.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ok: false, detail: expect.objectContaining({ failed: 1 }) }),
    })
    expect(prisma.hiringUploadSession.delete).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
