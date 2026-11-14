/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../complete/route'

jest.mock('@/lib/hiring/lock-open-posting', () => ({ lockOpenPosting: jest.fn(), PostingClosedError: class extends Error {} }))
jest.mock('@/lib/hiring/applications', () => ({ checkRateLimit: () => true }))
jest.mock('@/lib/hiring/public-request', () => ({ publicRequestKey: () => 'synthetic' }))
jest.mock('@/lib/hiring/form-values', () => ({ typedSubmissionError: () => null }))
jest.mock('@/lib/hiring/pii', () => ({ buildApplicationPii: () => ({ columns: {}, sanitizedEntries: [] }) }))
jest.mock('@/lib/hiring/upload-protocol', () => ({
  ...jest.requireActual('@/lib/hiring/upload-protocol'),
  completeUploadSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}))
jest.mock('@/lib/prisma', () => {
  const { Client } = jest.requireActual<typeof import('pg')>('pg')
  const client = new Client()
  const ready = client.connect()
  const prisma = {
    hiringPosting: { findUnique: jest.fn().mockResolvedValue({ id: 'post', uuid: 'post', spaceId: 'cabcdefghijklmnopqrstuvwx', status: 'ACTIVE', closingDate: null, positions: [], stores: [], applicationEntries: [] }) },
    hiringUploadSession: {
      findFirst: jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000012', postingId: 'post', spaceId: 'cabcdefghijklmnopqrstuvwx', files: [], expiresAt: new Date(Date.now() + 60000), completedAt: null }),
      findUnique: jest.fn().mockResolvedValue({ completedAt: null }),
      updateMany: jest.fn(async () => {
        await ready
        const result = await client.query(`UPDATE "HiringUploadSession" SET "claimedAt"=now()-interval '10 minutes', "requestHash"='synthetic-complete' WHERE id='00000000-0000-4000-8000-000000000012' AND "expiresAt">now()-interval '10 minutes' AND "claimedAt" IS NULL`)
        return { count: result.rowCount }
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma)),
    close: async () => { await ready; await client.end() },
  }
  return { prisma }
})
const localTest = process.env.WORKDECK_CLEANUP_LOCAL_TEST === '1' ? it : it.skip

localTest('앱 시계가 뒤처져도 DB 만료 완료 claim은 기존 충돌 응답을 반환한다', async () => {
  const request = new NextRequest('http://localhost/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postingUuid: 'post', entries: [], privacyAgreed: true, uploadSessionId: '00000000-0000-4000-8000-000000000012', uploadToken: 'a'.repeat(64) }) })
  const response = await POST(request)
  expect(response.status).toBe(409)
  const { prisma } = jest.requireMock('@/lib/prisma')
  await prisma.close()
})
