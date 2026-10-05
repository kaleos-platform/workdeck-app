/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { createPublicApplication } from '@/lib/hiring/applications'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findUnique: jest.fn() },
    hiringApplication: { count: jest.fn(async () => 0) },
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/sc/utm', () => ({ hashIp: () => 'test' }))
jest.mock('@/lib/hiring/applications', () => ({
  checkRateLimit: () => true,
  MAX_APPLICANT_FILES: 3,
  createPublicApplication: jest.fn(async () => ({ uuid: 'qa' })),
}))
jest.mock('@/lib/hiring/storage', () => ({
  ALLOWED_APPLICANT_MIME: new Set(['application/pdf']),
  MAX_APPLICANT_FILE_BYTES: 1000,
}))
beforeEach(() => jest.clearAllMocks())
const standardEntries = [
  { key: 'name', type: 'string', value: '합성 지원자' },
  { key: 'phone', type: 'phone', value: '01012345678' },
]
it.each([
  ['date', '2026-02-30', 400],
  ['number', 'Infinity', 400],
  ['number', '0', 201],
  ['text', '1234', 400],
  ['text', '123', 201],
])('공고의 %s 정의로 %s를 검증한다', async (type, value, expected) => {
  ;(prisma.hiringPosting.findUnique as jest.Mock).mockResolvedValue({
    id: 'post',
    spaceId: 'space',
    status: 'ACTIVE',
    positions: [],
    stores: [],
    applicationEntries: [
      {
        key: 'qa',
        type,
        label: 'QA',
        required: true,
        ...(type === 'text' ? { maxLength: 3, errorMessage: '세 글자 이내로 입력하세요' } : {}),
      },
    ],
  })
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      postingUuid: 'post-uuid',
      entries: [...standardEntries, { key: 'qa', type, value }],
      privacyAgreed: true,
    })
  )
  const response = await POST(
    new NextRequest('http://localhost/api/hiring-public/applications', {
      method: 'POST',
      body: form,
    })
  )
  expect(response.status).toBe(expected)
  if (type === 'text' && expected === 400)
    expect(await response.json()).toEqual({ message: '세 글자 이내로 입력하세요' })
  expect(createPublicApplication).toHaveBeenCalledTimes(expected === 201 ? 1 : 0)
})

it.each([
  [[], false, 400],
  [[], true, 400],
  [['unknown'], true, 400],
  [['resume'], true, 201],
])('필수 파일과 항목 연결을 검증한다 (%j)', async (keys, attach, expected) => {
  ;(prisma.hiringPosting.findUnique as jest.Mock).mockResolvedValue({
    id: 'post',
    spaceId: 'space',
    status: 'ACTIVE',
    positions: [],
    stores: [],
    applicationEntries: [{ key: 'resume', type: 'file', label: '이력서', required: true }],
  })
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      postingUuid: 'qa',
      entries: [...standardEntries, { key: 'resume', type: 'file', value: 'same.pdf' }],
      fileFieldKeys: keys,
      privacyAgreed: true,
    })
  )
  if (attach) form.append('files', new File(['pdf'], 'same.pdf', { type: 'application/pdf' }))
  const response = await POST(
    new NextRequest('http://localhost/api/hiring-public/applications', {
      method: 'POST',
      body: form,
    })
  )
  expect(response.status).toBe(expected)
  expect(createPublicApplication).toHaveBeenCalledTimes(expected === 201 ? 1 : 0)
  if (expected === 201)
    expect((createPublicApplication as jest.Mock).mock.calls[0][0].files[0].fieldKey).toBe('resume')
})

it.each([
  [2, 3, 201],
  [3, 3, 400],
  [1, 4, 400],
])('항목별 개수 %s/크기 %s 제한을 API에서도 적용한다', async (count, bytes, expected) => {
  ;(prisma.hiringPosting.findUnique as jest.Mock).mockResolvedValue({
    id: 'post',
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
        maxFileCount: 2,
        maxFileSize: 3,
      },
    ],
  })
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({
      postingUuid: 'qa',
      entries: [...standardEntries, { key: 'resume', type: 'file', value: [] }],
      fileFieldKeys: Array(count).fill('resume'),
      privacyAgreed: true,
    })
  )
  for (let i = 0; i < count; i++)
    form.append('files', new File(['x'.repeat(bytes)], 'same.pdf', { type: 'application/pdf' }))
  const response = await POST(
    new NextRequest('http://localhost/api/hiring-public/applications', {
      method: 'POST',
      body: form,
    })
  )
  expect(response.status).toBe(expected)
  expect(createPublicApplication).toHaveBeenCalledTimes(expected === 201 ? 1 : 0)
})

it('일반 필수 항목을 누락하면 첨부 없는 API 직접 호출도 저장하지 않는다', async () => {
  ;(prisma.hiringPosting.findUnique as jest.Mock).mockResolvedValue({
    id: 'post',
    spaceId: 'space',
    status: 'ACTIVE',
    positions: [],
    stores: [],
    applicationEntries: [],
  })
  const form = new FormData()
  form.set('payload', JSON.stringify({ postingUuid: 'qa', entries: [], privacyAgreed: true }))
  const response = await POST(
    new NextRequest('http://localhost/api/hiring-public/applications', {
      method: 'POST',
      body: form,
    })
  )
  expect(response.status).toBe(400)
  expect(createPublicApplication).not.toHaveBeenCalled()
})

it('발행 상태여도 마감일이 지난 공고의 제출을 거부한다', async () => {
  jest
    .mocked(prisma.hiringPosting.findUnique)
    .mockResolvedValue({ status: 'ACTIVE', closingDate: new Date('2023-11-30') } as never)
  const form = new FormData()
  form.set(
    'payload',
    JSON.stringify({ postingUuid: 'post-uuid', entries: standardEntries, privacyAgreed: true })
  )
  const response = await POST(
    new NextRequest('http://localhost/api/hiring-public/applications', {
      method: 'POST',
      body: form,
    })
  )
  expect(response.status).toBe(410)
  expect(createPublicApplication).not.toHaveBeenCalled()
})
