/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadTokenHash } from '@/lib/hiring/upload-protocol'
import { inspectApplicantUpload } from '@/lib/hiring/storage'
import { POST as complete } from '../../../../app/api/hiring-public/upload-sessions/complete/route'
import { createPublicApplication } from '@/lib/hiring/applications'
import { lockOpenPosting, PostingClosedError } from '@/lib/hiring/lock-open-posting'
import { POST as action } from '../../../../app/api/hiring-posts/postings/[id]/actions/route'

jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveDeckContext: async () => ({
    space: { id: process.env.QA_RACE_SPACE },
    role: 'ADMIN',
    user: { id: 'qa' },
  }),
}))
jest.mock('@/lib/hiring/applications', () => ({
  ...jest.requireActual('@/lib/hiring/applications'),
  checkRateLimit: () => true,
}))
jest.mock('@/lib/hiring/storage', () => ({
  ...jest.requireActual('@/lib/hiring/storage'),
  inspectApplicantUpload: jest.fn(),
}))

it('공고를 확인한 뒤 저장 전에 마감되면 지원을 거부한다', async () => {
  const ref = 'tumkfkfgzkmisguyaghn'
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !== `${ref}.supabase.co`)
    throw Error('DEV_PROJECT_REQUIRED')
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = process.env[key]
    if (!value) continue
    const url = new URL(value)
    if (
      url.hostname !== `db.${ref}.supabase.co` &&
      !(
        url.hostname.endsWith('.pooler.supabase.com') &&
        decodeURIComponent(url.username).endsWith(`.${ref}`)
      )
    )
      throw Error('DEV_DATABASE_REQUIRED')
  }
  if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) throw Error('DEV_DATABASE_REQUIRED')
  const spaceId = `qa-race-${randomUUID()}`
  process.env.QA_RACE_SPACE = spaceId
  process.env.HIRING_HMAC_KEY = randomBytes(32).toString('hex')
  process.env.ENCRYPTION_KEY_PII = randomBytes(32).toString('hex')
  process.env.ENCRYPTION_WRITE_VERSION = 'v1'
  try {
    await prisma.space.create({ data: { id: spaceId, name: '합성 경합 검사' } })
    const posting = await prisma.hiringPosting.create({
      data: {
        spaceId,
        title: '합성 경합 공고',
        status: 'ACTIVE',
        notificationEnabled: false,
        applicationEntries: [
          {
            key: 'resume',
            type: 'file',
            label: '첨부',
            required: true,
            maxFileCount: 3,
            maxFileSize: 20971520,
          },
        ],
      },
    })
    const sessionId = randomUUID(),
      fileId = randomUUID(),
      token = randomBytes(32).toString('hex')
    await prisma.hiringUploadSession.create({
      data: {
        id: sessionId,
        spaceId,
        postingId: posting.id,
        tokenHash: uploadTokenHash(token),
        expiresAt: new Date(Date.now() + 60000),
        files: [
          {
            id: fileId,
            fieldKey: 'resume',
            fileName: 'synthetic.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 12,
            path: `${spaceId}/applications/${sessionId}/${fileId}.pdf`,
          },
        ],
      },
    })
    jest.mocked(inspectApplicantUpload).mockImplementation(async () => {
      const res = await action(
        new NextRequest('http://localhost/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'close' }),
        }),
        { params: Promise.resolve({ id: posting.id }) }
      )
      expect(res?.status).toBe(200)
      return { sizeBytes: 12, mimeType: 'application/pdf' }
    })
    const res = await complete(
      new NextRequest('http://localhost/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postingUuid: posting.uuid,
          uploadSessionId: sessionId,
          uploadToken: token,
          entries: [
            { key: 'name', type: 'string', value: '합성' },
            { key: 'phone', type: 'phone', value: '01000000000' },
          ],
          privacyAgreed: true,
        }),
      })
    )
    expect(res.status).toBe(410)
    expect(
      await prisma.hiringApplication.count({ where: { spaceId, postingId: posting.id } })
    ).toBe(0)
    await expect(
      createPublicApplication({
        posting: { id: posting.id, spaceId },
        entries: [],
        files: [],
        privacyAgreed: true,
      })
    ).rejects.toBeInstanceOf(PostingClosedError)
    expect(
      await prisma.hiringApplication.count({ where: { spaceId, postingId: posting.id } })
    ).toBe(0)
    const openPosting = await prisma.hiringPosting.create({
      data: { spaceId, title: '합성 완료 우선 공고', status: 'ACTIVE', notificationEnabled: false },
    })
    const nextToken = randomBytes(32).toString('hex')
    const nextSession = await prisma.hiringUploadSession.create({
      data: {
        spaceId,
        postingId: openPosting.id,
        tokenHash: uploadTokenHash(nextToken),
        expiresAt: new Date(Date.now() + 60000),
        files: [],
      },
    })
    const body = {
      postingUuid: openPosting.uuid,
      uploadSessionId: nextSession.id,
      uploadToken: nextToken,
      entries: [
        { key: 'name', type: 'string', value: '합성' },
        { key: 'phone', type: 'phone', value: '01000000000' },
      ],
      privacyAgreed: true,
    }
    const submit = () =>
      complete(
        new NextRequest('http://localhost/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
    const first = await submit()
    expect(first.status).toBe(201)
    const firstResult = await first.json()
    const close = await action(
      new NextRequest('http://localhost/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      }),
      { params: Promise.resolve({ id: openPosting.id }) }
    )
    expect(close?.status).toBe(200)
    const retry = await submit()
    expect(retry.status).toBe(201)
    expect(await retry.json()).toEqual(firstResult)
    expect(
      await prisma.hiringApplication.count({ where: { spaceId, postingId: openPosting.id } })
    ).toBe(1)
    const lockingPost = await prisma.hiringPosting.create({
      data: { spaceId, title: '합성 잠금 공고', status: 'ACTIVE' },
    })
    const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
    await client.connect()
    let update: Promise<unknown> | undefined
    try {
      await prisma.$transaction(async (tx) => {
        await lockOpenPosting(tx, lockingPost.id, spaceId)
        update = client.query('UPDATE "HiringPosting" SET "status" = $1 WHERE "id" = $2', [
          'CLOSED',
          lockingPost.id,
        ])
        const result = await Promise.race([
          update.then(() => 'updated'),
          new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 150)),
        ])
        expect(result).toBe('waiting')
      })
      await update
      expect(
        (await prisma.hiringPosting.findUniqueOrThrow({ where: { id: lockingPost.id } })).status
      ).toBe('CLOSED')
    } finally {
      await client.end()
    }
  } finally {
    await prisma.space.deleteMany({ where: { id: spaceId } })
    expect(await prisma.space.count({ where: { id: spaceId } })).toBe(0)
    expect(await prisma.hiringPosting.count({ where: { spaceId } })).toBe(0)
    expect(await prisma.hiringApplication.count({ where: { spaceId } })).toBe(0)
    expect(await prisma.hiringUploadSession.count({ where: { spaceId } })).toBe(0)
    await prisma.$disconnect()
  }
})
