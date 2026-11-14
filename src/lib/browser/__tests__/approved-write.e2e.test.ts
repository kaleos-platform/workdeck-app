/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import {
  BROWSER_ROUNDTRIP_ACTION,
  claimBrowserWrite,
  enqueueBrowserWrite,
  reportBrowserWrite,
} from '../approved-write'

// 운영·공유 개발 DB에서 실행하지 않는다. 이 테스트는 throwaway 로컬 PostgreSQL 전용이다.
const localOnly =
  process.env.EGO_WRITE_TEST_DATABASE === '1' &&
  /^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(process.env.DIRECT_URL ?? '')
const suite = localOnly ? describe : describe.skip
const spaceId = 'ego-write-isolated-test'
const params = {
  identity: 'cafe24-admin',
  mallId: 'ameaning24',
  shopNo: 1,
  skinNo: 24,
  skinCode: 'skin15',
  file: '/index.html' as const,
  originalSha256: 'a'.repeat(64),
  markerId: 'pilot-1',
}

suite('승인 브라우저 작업의 실제 DB 경합·격리', () => {
  beforeAll(async () => {
    await prisma.space.create({
      data: { id: spaceId, name: 'Ego isolated test', type: 'PERSONAL' },
    })
  })
  afterEach(async () => {
    await prisma.browserWriteJob.deleteMany({ where: { spaceId } })
    await prisma.agentPendingAction.deleteMany({ where: { spaceId } })
  })
  afterAll(async () => {
    await prisma.space.delete({ where: { id: spaceId } })
    await prisma.$disconnect()
  })

  async function action(status: 'PENDING' | 'APPROVED') {
    return prisma.agentPendingAction.create({
      data: {
        spaceId,
        actionType: BROWSER_ROUNDTRIP_ACTION,
        deckKey: 'seller-hub',
        payload: params,
        summary: '고정 개발 스킨 주석 검증',
        source: 'WEB',
        actorType: 'user',
        actorId: 'test-user',
        status,
        decidedBy: status === 'APPROVED' ? 'test-user' : null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
  }

  it('미승인은 enqueue할 수 없고 승인 실행 완료 전에는 claim하지 않는다', async () => {
    const pending = await action('PENDING')
    await expect(enqueueBrowserWrite(spaceId, pending.id, params)).rejects.toThrow('승인')
    const approved = await action('APPROVED')
    await expect(
      enqueueBrowserWrite(spaceId, approved.id, { ...params, skinNo: 14 })
    ).rejects.toThrow('일치')
    await enqueueBrowserWrite(spaceId, approved.id, params)
    expect(await claimBrowserWrite(spaceId, 'token-1')).toBeNull()
  })

  it('동시 claim 승자는 하나이며 다른 Space·토큰의 보고와 재실행은 막힌다', async () => {
    const approved = await action('APPROVED')
    await enqueueBrowserWrite(spaceId, approved.id, params)
    await prisma.agentPendingAction.update({
      where: { id: approved.id },
      data: { status: 'EXECUTED' },
    })
    expect(await claimBrowserWrite('another-space', 'token-1')).toBeNull()
    const candidates = await Promise.all(
      Array.from({ length: 8 }, () => claimBrowserWrite(spaceId, 'token-1'))
    )
    const winners = candidates.filter((job) => job !== null)
    expect(winners).toHaveLength(1)
    const job = winners[0]!
    const report = {
      claimId: job.claimId!,
      outcome: 'RESTORED',
      originalSha256: params.originalSha256,
      writtenSha256: 'b'.repeat(64),
      restoredSha256: params.originalSha256,
      taskSpaceId: 171,
      taskSpaceFinished: true,
    }
    await expect(reportBrowserWrite(spaceId, 'token-2', job.id, report)).rejects.toThrow('실행 중')
    await expect(reportBrowserWrite('another-space', 'token-1', job.id, report)).rejects.toThrow(
      '실행 중'
    )
    await expect(reportBrowserWrite(spaceId, 'token-1', job.id, report)).resolves.toMatchObject({
      browserStatus: 'RESTORED',
    })
    expect(await claimBrowserWrite(spaceId, 'token-1')).toBeNull()
    await expect(reportBrowserWrite(spaceId, 'token-1', job.id, report)).rejects.toThrow('실행 중')
  })

  it('만료된 대기 작업은 EXPIRED가 되며 실행하지 않는다', async () => {
    const approved = await action('APPROVED')
    const { jobId } = await enqueueBrowserWrite(spaceId, approved.id, params)
    await prisma.agentPendingAction.update({
      where: { id: approved.id },
      data: { status: 'EXECUTED' },
    })
    await prisma.browserWriteJob.update({ where: { id: jobId }, data: { expiresAt: new Date(0) } })
    expect(await claimBrowserWrite(spaceId, 'token-1')).toBeNull()
    expect((await prisma.browserWriteJob.findUnique({ where: { id: jobId } }))?.status).toBe(
      'EXPIRED'
    )
  })

  it('브라우저 작업 테이블에 RLS가 적용된다', async () => {
    const rows = await prisma.$queryRaw<{ enabled: boolean }[]>`
      SELECT relrowsecurity AS enabled FROM pg_class
      WHERE oid = 'public."BrowserWriteJob"'::regclass`
    expect(rows).toEqual([{ enabled: true }])
  })
})
