/** @jest-environment node */
import { createPublicApplication } from '../applications'
import { prisma } from '@/lib/prisma'
import { uploadApplicantFile, removeApplicantFiles } from '@/lib/hiring/storage'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    hiringApplication: { delete: jest.fn(), updateMany: jest.fn() },
    hiringApplicationFile: { create: jest.fn() },
  },
}))
jest.mock('../lock-open-posting', () => ({ lockOpenPosting: jest.fn() }))
jest.mock('@/lib/hiring/pii', () => ({
  buildApplicationPii: (entries: unknown[]) => ({ columns: {}, sanitizedEntries: entries }),
}))
jest.mock('@/lib/hiring/storage', () => ({
  uploadApplicantFile: jest.fn(),
  removeApplicantFiles: jest.fn(),
  ALLOWED_APPLICANT_MIME: new Set(['application/pdf']),
  MAX_APPLICANT_FILE_BYTES: 1000,
}))

const request = {
  posting: { id: 'posting', spaceId: 'space' },
  entries: [{ key: 'resume', type: 'file', value: null }],
  files: [
    {
      fieldKey: 'resume',
      fileName: 'sample.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('x'),
    },
  ],
  privacyAgreed: true,
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (callback) =>
    callback({
      hiringApplication: { create: async () => ({ id: 'app', uuid: 'uuid' }) },
    })
  )
  ;(uploadApplicantFile as jest.Mock).mockResolvedValue({ path: 'opaque-path' })
  ;(prisma.hiringApplicationFile.create as jest.Mock).mockRejectedValue(new Error('upload failed'))
  ;(removeApplicantFiles as jest.Mock).mockResolvedValue(undefined)
})

test('하드 삭제 실패 후 같은 지원서만 숨기고 원래 오류를 반환한다', async () => {
  ;(prisma.hiringApplication.delete as jest.Mock).mockRejectedValue(new Error('db failure'))
  ;(prisma.hiringApplication.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  await expect(createPublicApplication(request)).rejects.toThrow('upload failed')
  expect(prisma.hiringApplication.updateMany).toHaveBeenCalledWith({
    where: { id: 'app', spaceId: 'space', deletedAt: null },
    data: { deletedAt: expect.any(Date) },
  })
  expect(removeApplicantFiles).toHaveBeenCalledWith(['opaque-path'])
  expect(log).toHaveBeenCalledWith('legacy application database compensation failed', {
    applicationId: 'app',
    hideResult: 'marked',
  })
  log.mockRestore()
})

test('정리와 숨김에 실패해도 민감 정보 없이 기록하고 원래 오류를 반환한다', async () => {
  ;(prisma.hiringApplication.delete as jest.Mock).mockRejectedValue(new Error('secret-db'))
  ;(prisma.hiringApplication.updateMany as jest.Mock).mockRejectedValue(new Error('secret-update'))
  ;(removeApplicantFiles as jest.Mock).mockRejectedValue(new Error('secret-storage'))
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  await expect(createPublicApplication(request)).rejects.toThrow('upload failed')
  expect(log).toHaveBeenCalledWith('legacy application database compensation failed', {
    applicationId: 'app',
    hideResult: 'failed',
  })
  expect(log).toHaveBeenCalledWith('legacy application storage compensation failed', {
    applicationId: 'app',
  })
  const output = JSON.stringify(log.mock.calls)
  expect(output).not.toMatch(/secret|opaque-path|sample\.pdf/)
  log.mockRestore()
})

test('Storage 삭제만 실패하면 지원서를 다시 숨기지 않고 실패 단계를 기록한다', async () => {
  ;(prisma.hiringApplication.delete as jest.Mock).mockResolvedValue({})
  ;(removeApplicantFiles as jest.Mock).mockRejectedValue(new Error('secret-storage'))
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  await expect(createPublicApplication(request)).rejects.toThrow('upload failed')
  expect(prisma.hiringApplication.updateMany).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith('legacy application storage compensation failed', {
    applicationId: 'app',
  })
  log.mockRestore()
})

test('정상 제출은 기존 결과를 반환하고 보상하지 않는다', async () => {
  ;(prisma.hiringApplicationFile.create as jest.Mock).mockResolvedValue({})
  await expect(createPublicApplication(request)).resolves.toEqual({ id: 'app', uuid: 'uuid' })
  expect(prisma.hiringApplication.delete).not.toHaveBeenCalled()
  expect(prisma.hiringApplication.updateMany).not.toHaveBeenCalled()
  expect(removeApplicantFiles).not.toHaveBeenCalled()
})

test('하드 삭제 결과가 불명확하고 표시할 행이 없으면 별도로 기록한다', async () => {
  ;(prisma.hiringApplication.delete as jest.Mock).mockRejectedValue(new Error('db failure'))
  ;(prisma.hiringApplication.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  await expect(createPublicApplication(request)).rejects.toThrow('upload failed')
  expect(log).toHaveBeenCalledWith('legacy application database compensation failed', {
    applicationId: 'app',
    hideResult: 'no_match',
  })
  log.mockRestore()
})

test('Storage 삭제가 지연되어도 DB 삭제 실패를 먼저 숨긴다', async () => {
  let finishStorage!: () => void
  ;(removeApplicantFiles as jest.Mock).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishStorage = resolve
      })
  )
  ;(prisma.hiringApplication.delete as jest.Mock).mockRejectedValue(new Error('db failure'))
  ;(prisma.hiringApplication.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  const submission = createPublicApplication(request).catch((error) => error)
  await new Promise<void>((resolve) => setImmediate(resolve))
  const hidden = (prisma.hiringApplication.updateMany as jest.Mock).mock.calls.length
  finishStorage()
  await submission
  expect(hidden).toBe(1)
  log.mockRestore()
})
