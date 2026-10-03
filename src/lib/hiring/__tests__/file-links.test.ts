/** @jest-environment node */
import { createPublicApplication } from '../applications'
import { prisma } from '@/lib/prisma'
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringApplication: {
      create: jest.fn(async () => ({ id: 'app', uuid: 'uuid' })),
      delete: jest.fn(),
    },
    hiringApplicationFile: { create: jest.fn() },
  },
}))
jest.mock('../pii', () => ({
  buildApplicationPii: (entries: unknown) => ({ columns: {}, sanitizedEntries: entries }),
}))
jest.mock('../storage', () => ({
  ALLOWED_APPLICANT_MIME: new Set(['application/pdf']),
  MAX_APPLICANT_FILE_BYTES: 1000,
  uploadApplicantFile: jest.fn(async () => ({ path: 'private/mock' })),
  removeApplicantFiles: jest.fn(),
}))
beforeEach(() => jest.clearAllMocks())
it('동일 파일명도 항목마다 다른 서버 ID로 연결하고 주입된 ID는 버린다', async () => {
  await createPublicApplication({
    posting: { id: 'post', spaceId: 'space' },
    privacyAgreed: true,
    entries: ['a', 'b'].map((key) => ({ key, type: 'file', value: 'fake', fileIds: ['injected'] })),
    files: ['a', 'b'].map((fieldKey) => ({
      fieldKey,
      fileName: 'same.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('pdf'),
    })),
  })
  const saved = (prisma.hiringApplication.create as jest.Mock).mock.calls[0][0].data
    .applicationEntries
  const rows = (prisma.hiringApplicationFile.create as jest.Mock).mock.calls.map(
    (call) => call[0].data
  )
  expect(saved[0]).toMatchObject({ key: 'a', value: 'same.pdf', fileIds: [rows[0].id] })
  expect(saved[1]).toMatchObject({ key: 'b', value: 'same.pdf', fileIds: [rows[1].id] })
  expect(rows[0].id).not.toBe(rows[1].id)
  expect(rows[0].id).not.toBe('injected')
})
it('연결할 제출 항목이 없으면 지원서 생성 전에 거부한다', async () => {
  await expect(
    createPublicApplication({
      posting: { id: 'post', spaceId: 'space' },
      privacyAgreed: true,
      entries: [],
      files: [
        {
          fieldKey: 'missing',
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          data: Buffer.from('pdf'),
        },
      ],
    })
  ).rejects.toThrow('공고에 없는 첨부 항목입니다')
  expect(prisma.hiringApplication.create).not.toHaveBeenCalled()
})

it('한 항목의 복수 파일명과 ID를 모두 저장한다', async () => {
  await createPublicApplication({
    posting: { id: 'post', spaceId: 'space' },
    privacyAgreed: true,
    entries: [{ key: 'a', type: 'file', value: null }],
    fileFields: [{ key: 'a', type: 'file', maxFileCount: 2, maxFileSize: 100 }],
    files: ['one.pdf', 'two.pdf'].map((fileName) => ({
      fieldKey: 'a',
      fileName,
      mimeType: 'application/pdf',
      data: Buffer.from('pdf'),
    })),
  })
  const saved = (prisma.hiringApplication.create as jest.Mock).mock.calls[0][0].data
    .applicationEntries[0]
  expect(saved.value).toEqual(['one.pdf', 'two.pdf'])
  expect(saved.fileIds).toHaveLength(2)
  expect(new Set(saved.fileIds).size).toBe(2)
})
