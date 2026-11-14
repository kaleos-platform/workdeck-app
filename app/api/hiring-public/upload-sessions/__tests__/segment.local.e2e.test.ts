/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: () => true }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'synthetic' }))
jest.mock('@/lib/hiring/storage', () => ({
  ALLOWED_APPLICANT_MIME: new Set(['application/pdf']), extFromMime: () => 'pdf',
  createApplicantUploadUrl: jest.fn().mockResolvedValue('https://storage.invalid/synthetic'),
}))
jest.mock('@/lib/prisma', () => ({ prisma: {
  hiringPosting: { findUnique: jest.fn().mockResolvedValue({ id: 'post', spaceId: 'TEAM_UUID-1', status: 'ACTIVE', closingDate: null,
    applicationEntries: [{ key: 'resume', type: 'file', label: '이력서', required: false, maxFileCount: 3, maxFileSize: 20971520 }] }) },
  hiringUploadSession: {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(async ({ data }: { data: { id: string; spaceId: string; files: unknown } }) => {
      const { Client } = jest.requireActual<typeof import('pg')>('pg')
      const client = new Client()
      await client.connect()
      try { await client.query('INSERT INTO "HiringUploadSession" (id,"spaceId",files) VALUES ($1,$2,$3::jsonb)', [data.id, data.spaceId, JSON.stringify(data.files)]) }
      finally { await client.end() }
    }),
  },
} }))
const localTest = process.env.WORKDECK_SEGMENT_LOCAL_TEST === '1' ? it : it.skip
localTest('비CUID Space의 파일 지원 준비는 실제 DB 원장 기록 후 성공한다', async () => {
  const request = new NextRequest('http://localhost/upload', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ postingUuid: 'synthetic', files: [{ fieldKey: 'resume', fileName: 'synthetic.pdf', mimeType: 'application/pdf', sizeBytes: 1 }] }) })
  const response = await POST(request)
  expect(response.status).toBe(201)
  expect((await response.json()).uploads).toHaveLength(1)
})
