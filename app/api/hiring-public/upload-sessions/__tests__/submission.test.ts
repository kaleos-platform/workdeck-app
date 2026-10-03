/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST as initiate } from '../route'
import { POST as complete } from '../complete/route'
import { prisma } from '@/lib/prisma'
import { inspectApplicantUpload, createApplicantUploadUrl } from '@/lib/hiring/storage'
import { submissionHash } from '@/lib/hiring/upload-protocol'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findUnique: jest.fn() },
    hiringUploadSession: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    hiringApplication: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: () => true }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'qa' }))
jest.mock('@/lib/hiring/pii', () => ({
  buildApplicationPii: (entries: unknown[]) => ({ columns: {}, sanitizedEntries: entries }),
}))
jest.mock('@/lib/hiring/storage', () => ({
  ALLOWED_APPLICANT_MIME: new Set(['application/pdf']),
  extFromMime: () => 'pdf',
  createApplicantUploadUrl: jest.fn(),
  inspectApplicantUpload: jest.fn(),
}))
const sessionId = '00000000-0000-4000-8000-000000000001'
const fileId = '00000000-0000-4000-8000-000000000002'
const token = 'a'.repeat(64)
const file = {
  fieldKey: 'resume',
  fileName: '합성.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 12 * 1024 * 1024,
}
const stored = { ...file, id: fileId, path: `space/applications/${sessionId}/${fileId}.pdf` }
const payload = {
  postingUuid: 'qa-post',
  fileFieldKeys: [],
  entries: [
    { key: 'name', type: 'string', value: '합성' },
    { key: 'phone', type: 'phone', value: '01012345678' },
  ],
  privacyAgreed: true as const,
  uploadSessionId: sessionId,
  uploadToken: token,
}
function request(body: unknown) {
  return new NextRequest('http://localhost/api/hiring-public/upload-sessions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
function session(extra = {}) {
  return {
    id: sessionId,
    postingId: 'post',
    spaceId: 'space',
    files: [stored],
    expiresAt: new Date(Date.now() + 60000),
    completedAt: null,
    ...extra,
  }
}
beforeEach(() => {
  jest.resetAllMocks()
  ;(prisma.hiringPosting.findUnique as jest.Mock).mockResolvedValue({
    id: 'post',
    uuid: 'qa-post',
    spaceId: 'space',
    status: 'ACTIVE',
    positions: [],
    stores: [],
    applicationEntries: [
      {
        key: 'resume',
        type: 'file',
        label: '이력서',
        required: true,
        maxFileCount: 3,
        maxFileSize: 20 * 1024 * 1024,
      },
    ],
  })
  ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue(session())
  ;(prisma.hiringUploadSession.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.hiringApplication.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.hiringApplication.create as jest.Mock).mockResolvedValue({
    id: sessionId,
    uuid: 'result',
  })
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma))
  ;(createApplicantUploadUrl as jest.Mock).mockResolvedValue('https://storage.example/signed')
  ;(inspectApplicantUpload as jest.Mock).mockResolvedValue({
    sizeBytes: file.sizeBytes,
    mimeType: file.mimeType,
  })
})
it('12MiB 파일은 서버 경로와 해시 토큰으로 직접 업로드 세션을 만든다', async () => {
  const response = await initiate(request({ postingUuid: 'qa-post', files: [file] }))
  expect(response.status).toBe(201)
  const body = await response.json()
  const data = (prisma.hiringUploadSession.create as jest.Mock).mock.calls[0][0].data
  expect(data.tokenHash).not.toBe(body.uploadToken)
  expect(data.files[0].path).toMatch(/^space\/applications\//)
  expect(body.uploadToken).toHaveLength(64)
})
it.each([
  [{ ...file, sizeBytes: 21 * 1024 * 1024 }],
  [{ ...file, fieldKey: 'foreign' }],
  [{ ...file, mimeType: 'text/html' }],
])('허용되지 않은 첨부는 서명 전에 차단한다', async (invalid) => {
  expect((await initiate(request({ postingUuid: 'qa-post', files: [invalid] }))).status).toBe(400)
  expect(createApplicantUploadUrl).not.toHaveBeenCalled()
})
it('완료 시 객체를 확인하고 세션과 첨부를 한 트랜잭션에 저장한다', async () => {
  expect((await complete(request(payload))).status).toBe(201)
  expect(inspectApplicantUpload).toHaveBeenCalledWith(stored.path)
  expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  const data = (prisma.hiringApplication.create as jest.Mock).mock.calls[0][0].data
  expect(data.files.create[0]).toMatchObject({ id: fileId, filePath: stored.path })
  expect(data.applicationEntries).toContainEqual({
    key: 'resume',
    type: 'file',
    label: '이력서',
    value: ['합성.pdf'],
    fileIds: [fileId],
  })
  expect(prisma.hiringUploadSession.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ applicationId: sessionId }) })
  )
})
it.each([null, session({ expiresAt: new Date(0) }), session({ postingId: null })])(
  '없는 권한·만료·삭제된 공고는 저장하지 않는다',
  async (value) => {
    ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue(value)
    expect((await complete(request(payload))).status).toBe(410)
    expect(prisma.hiringApplication.create).not.toHaveBeenCalled()
  }
)
it.each([
  { sizeBytes: 1, mimeType: file.mimeType },
  { sizeBytes: file.sizeBytes, mimeType: 'text/html' },
])('실제 객체가 선언과 다르면 저장하지 않는다', async (metadata) => {
  ;(inspectApplicantUpload as jest.Mock).mockResolvedValue(metadata)
  expect((await complete(request(payload))).status).toBe(400)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
it('업로드가 없으면 재시도 가능한 오류로 남긴다', async () => {
  ;(inspectApplicantUpload as jest.Mock).mockRejectedValue(Error('missing'))
  expect((await complete(request(payload))).status).toBe(409)
  expect(prisma.hiringApplication.create).not.toHaveBeenCalled()
})
it('응답 유실 뒤 만료되어도 같은 완료 결과를 반환한다', async () => {
  ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue(
    session({
      expiresAt: new Date(0),
      completedAt: new Date(),
      requestHash: submissionHash(payload),
      applicationId: sessionId,
    })
  )
  ;(prisma.hiringApplication.findFirst as jest.Mock).mockResolvedValue({ uuid: 'original' })
  const response = await complete(request(payload))
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ uuid: 'original' })
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
it('완료된 첨부로 다른 지원서를 만들 수 없다', async () => {
  ;(prisma.hiringUploadSession.findFirst as jest.Mock).mockResolvedValue(
    session({ completedAt: new Date(), requestHash: 'different', applicationId: sessionId })
  )
  expect((await complete(request(payload))).status).toBe(409)
  expect(prisma.hiringApplication.create).not.toHaveBeenCalled()
})
it('동시 완료 claim을 놓쳐도 먼저 저장된 같은 지원서를 반환한다', async () => {
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.hiringUploadSession.findUnique as jest.Mock).mockResolvedValue(
    session({
      completedAt: new Date(),
      requestHash: submissionHash(payload),
      applicationId: sessionId,
    })
  )
  ;(prisma.hiringApplication.findUniqueOrThrow as jest.Mock).mockResolvedValue({ uuid: 'original' })
  expect(await (await complete(request(payload))).json()).toEqual({ uuid: 'original' })
  expect(prisma.hiringApplication.create).not.toHaveBeenCalled()
})
