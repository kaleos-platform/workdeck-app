/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DELETE as deletePostingRoute } from '../../../../app/api/hiring-posts/postings/[id]/route'
import { DELETE as deleteApplicationRoute } from '../../../../app/api/hiring-applicants/applications/[id]/route'
import { DELETE as bulkDeleteRoute } from '../../../../app/api/hiring-applicants/applications/bulk/route'
import { processFileDeletions } from '../delete'
import { removeCleanupFiles } from '../cleanup-storage'

// 역할·space 는 테스트마다 바꾼다(jest.mock 팩토리는 호이스팅되므로 변수명이 mock 접두사여야 한다).
const mockCtx = { spaceId: '', role: 'ADMIN' }
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: mockCtx.spaceId }, role: mockCtx.role }),
  assertRole: (role: string) =>
    role === 'MEMBER' ? Response.json({ message: '권한이 없습니다' }, { status: 403 }) : null,
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('../cleanup-storage', () => ({ removeCleanupFiles: jest.fn(async () => undefined) }))

// 업로드 세션 트리거가 cuid 형식 spaceId 를 요구한다.
const cuidLike = () => `c${randomUUID().replaceAll('-', '').slice(0, 24)}`
const spaceA = cuidLike()
const spaceB = cuidLike()
let created = false

beforeAll(async () => {
  if (
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname !==
    'tumkfkfgzkmisguyaghn.supabase.co'
  )
    throw Error('DEV_PROJECT_REQUIRED')
  await prisma.space.createMany({
    data: [
      { id: spaceA, name: '[QA] 삭제 A' },
      { id: spaceB, name: '[QA] 삭제 B' },
    ],
  })
  created = true
})

afterAll(async () => {
  if (!created) return
  await prisma.hiringMigrationRecord.deleteMany({ where: { spaceId: { in: [spaceA, spaceB] } } })
  await prisma.hiringFileDeletion.deleteMany({ where: { spaceId: { in: [spaceA, spaceB] } } })
  await prisma.hiringUploadCleanup.deleteMany({ where: { spaceId: { in: [spaceA, spaceB] } } })
  await prisma.space.deleteMany({ where: { id: { in: [spaceA, spaceB] } } })
  await prisma.$disconnect()
})

beforeEach(() => {
  mockCtx.spaceId = spaceA
  mockCtx.role = 'ADMIN'
  jest.mocked(removeCleanupFiles).mockReset().mockResolvedValue(undefined)
})

const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const req = (body?: unknown) =>
  new NextRequest('http://localhost/x', {
    method: 'DELETE',
    body: body ? JSON.stringify(body) : undefined,
  })
// 파일 참조 트리거가 허용하는 이관 경로 형식(spaceId/migration/<64hex>/<64hex>).
const hex64 = () => (randomUUID() + randomUUID()).replaceAll('-', '')
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000)

describe('공고 삭제', () => {
  it('모집중 공고는 409, 그대로 남는다', async () => {
    const p = await prisma.hiringPosting.create({
      data: { spaceId: spaceA, title: '[QA] 모집중', status: 'ACTIVE', closingDate: day(5) },
    })
    expect((await deletePostingRoute(req(), idParams(p.id)))?.status).toBe(409)
    expect(await prisma.hiringPosting.count({ where: { id: p.id } })).toBe(1)
  })

  it.each([
    ['CLOSED', null],
    ['DRAFT', null],
    ['ACTIVE', -3],
  ] as const)('%s(마감일 %s) 공고는 삭제된다', async (status, closing) => {
    const p = await prisma.hiringPosting.create({
      data: {
        spaceId: spaceA,
        title: '[QA] 삭제',
        status,
        closingDate: closing === null ? null : day(closing),
      },
    })
    const res = await deletePostingRoute(req(), idParams(p.id))
    expect(res?.status).toBe(200)
    expect(await prisma.hiringPosting.count({ where: { id: p.id } })).toBe(0)
  })

  it('MEMBER 는 403, 다른 space 공고는 404', async () => {
    const p = await prisma.hiringPosting.create({
      data: { spaceId: spaceA, title: '[QA] 권한', status: 'CLOSED' },
    })
    mockCtx.role = 'MEMBER'
    expect((await deletePostingRoute(req(), idParams(p.id)))?.status).toBe(403)
    mockCtx.role = 'ADMIN'
    mockCtx.spaceId = spaceB
    expect((await deletePostingRoute(req(), idParams(p.id)))?.status).toBe(404)
    expect(await prisma.hiringPosting.count({ where: { id: p.id } })).toBe(1)
  })

  it('지원자·첨부·세션을 지우고 경로 원장을 남기며 이관 기록 사본을 비운다', async () => {
    const p = await prisma.hiringPosting.create({
      data: { spaceId: spaceA, title: '[QA] 전체', status: 'CLOSED' },
    })
    const pathA = `${spaceA}/migration/${hex64()}/${hex64()}`
    const a = await prisma.hiringApplication.create({
      data: {
        spaceId: spaceA,
        postingId: p.id,
        files: {
          create: {
            spaceId: spaceA,
            fileName: 'a.pdf',
            filePath: pathA,
            mimeType: 'application/pdf',
            sizeBytes: 1,
          },
        },
      },
    })
    const sessionId = randomUUID()
    const pathS = `${spaceA}/applications/${sessionId}/${randomUUID()}.pdf`
    await prisma.hiringUploadSession.create({
      data: {
        id: sessionId,
        spaceId: spaceA,
        postingId: p.id,
        tokenHash: randomUUID(),
        files: [{ id: pathS.split('/')[3].replace('.pdf', ''), path: pathS }],
        expiresAt: day(1),
      },
    })
    await prisma.hiringMigrationRecord.createMany({
      data: [
        ['HiringPosting', p.id],
        ['HiringApplication', a.id],
      ].map(([targetModel, targetId]) => ({
        sourceRef: `qa-${randomUUID()}`,
        spaceId: spaceA,
        sourceSnapshotAt: new Date(),
        transformVersion: 'qa',
        sourceHash: 'h',
        targetModel,
        targetId,
        targetHash: 'h',
        sourceSnapshotEnc: 'enc',
        sourceSnapshotIv: 'iv',
        metadata: { keep: 1 },
      })),
    })
    // 즉시 Storage 삭제가 실패하는 경우 → 원장 행이 남아야 한다.
    jest.mocked(removeCleanupFiles).mockRejectedValue(Error('storage down'))

    const res = await deletePostingRoute(req(), idParams(p.id))
    expect(await res?.json()).toEqual({ ok: true, deletedApplications: 1 })
    expect(await prisma.hiringApplication.count({ where: { postingId: p.id } })).toBe(0)
    expect(await prisma.hiringUploadSession.count({ where: { postingId: p.id } })).toBe(0)
    const ledger = await prisma.hiringFileDeletion.findMany({ where: { spaceId: spaceA } })
    expect(ledger).toHaveLength(1)
    expect((ledger[0].paths as string[]).sort()).toEqual([pathA, pathS].sort())
    expect(ledger[0].attempts).toBe(1) // 즉시 시도 실패 → attempts+1

    const records = await prisma.hiringMigrationRecord.findMany({ where: { spaceId: spaceA } })
    expect(records).toHaveLength(2)
    for (const r of records) {
      expect(r.sourceSnapshotEnc).toBeNull()
      expect(r.sourceSnapshotIv).toBeNull()
      expect(r.metadata).toMatchObject({ keep: 1, deletedAt: expect.any(String) })
    }

    // cron 재시도: 성공하면 원장 행 삭제
    jest.mocked(removeCleanupFiles).mockResolvedValue(undefined)
    await expect(processFileDeletions()).resolves.toMatchObject({ failed: 0 })
    expect(await prisma.hiringFileDeletion.count({ where: { spaceId: spaceA } })).toBe(0)
  })
})

describe('지원자 삭제', () => {
  it('단건: 없는/다른 space 는 404, 정상은 삭제 + 즉시 Storage 삭제 후 원장 비움', async () => {
    const p = await prisma.hiringPosting.create({
      data: { spaceId: spaceA, title: '[QA] 단건', status: 'CLOSED' },
    })
    const pathB = `${spaceA}/migration/${hex64()}/${hex64()}`
    const a = await prisma.hiringApplication.create({
      data: {
        spaceId: spaceA,
        postingId: p.id,
        files: {
          create: {
            spaceId: spaceA,
            fileName: 'b.pdf',
            filePath: pathB,
            mimeType: 'application/pdf',
            sizeBytes: 1,
          },
        },
      },
    })
    mockCtx.spaceId = spaceB
    expect((await deleteApplicationRoute(req(), idParams(a.id)))?.status).toBe(404)
    mockCtx.spaceId = spaceA
    mockCtx.role = 'MEMBER'
    expect((await deleteApplicationRoute(req(), idParams(a.id)))?.status).toBe(403)
    mockCtx.role = 'ADMIN'
    const res = await deleteApplicationRoute(req(), idParams(a.id))
    expect(await res?.json()).toEqual({ deleted: 1 })
    expect(removeCleanupFiles).toHaveBeenCalledWith([pathB])
    expect(await prisma.hiringFileDeletion.count({ where: { spaceId: spaceA } })).toBe(0)
  })

  it('일괄: 다른 space id 는 제외되고 MEMBER 는 403', async () => {
    const [pa, pb] = await Promise.all(
      [spaceA, spaceB].map((spaceId) =>
        prisma.hiringPosting.create({ data: { spaceId, title: '[QA] 일괄', status: 'CLOSED' } })
      )
    )
    const mine = await prisma.hiringApplication.create({
      data: { spaceId: spaceA, postingId: pa.id },
    })
    const theirs = await prisma.hiringApplication.create({
      data: { spaceId: spaceB, postingId: pb.id },
    })
    mockCtx.role = 'MEMBER'
    expect((await bulkDeleteRoute(req({ ids: [mine.id] })))?.status).toBe(403)
    mockCtx.role = 'ADMIN'
    const res = await bulkDeleteRoute(req({ ids: [mine.id, theirs.id] }))
    expect(await res?.json()).toEqual({ deleted: 1 })
    expect(await prisma.hiringApplication.count({ where: { id: theirs.id } })).toBe(1)
    expect(await prisma.hiringApplication.count({ where: { id: mine.id } })).toBe(0)
  })
})
