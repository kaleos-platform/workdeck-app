/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { toolAuditLog: { create: jest.fn(), update: jest.fn() } },
}))
import { prisma } from '@/lib/prisma'
import { finishToolAudit, startToolAudit, summarizeArgs } from '../audit'

const ENTRY = {
  spaceId: 'sp1',
  workId: 'wk',
  actor: { type: 'agent' as const, id: 'ag1' },
  requesterUserId: null,
  tool: 't',
  args: {},
}

describe('audit', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  it('summarizeArgs redacts secrets (키 이름 기준)', () => {
    const s = summarizeArgs({
      campaignId: 'c1',
      accessToken: 'EAAB',
      nested: { app_secret: 'x', password: 'p' },
    })
    expect(s).toContain('c1')
    expect(s).not.toContain('EAAB')
    expect(s).not.toContain('"x"')
    expect(s).toContain('[redacted]')
  })
  it('wdk_agt_ 토큰 값은 키 이름과 무관하게 마스킹', () => {
    expect(summarizeArgs({ note: 'wdk_agt_abc.def' })).not.toContain('wdk_agt_abc')
  })
  it('1000자를 넘으면 자른다', () => {
    expect(summarizeArgs({ q: 'a'.repeat(5000) }).length).toBeLessThanOrEqual(1000)
  })
  it('start는 started 행을 만들고 id를 돌려준다', async () => {
    ;(prisma.toolAuditLog.create as jest.Mock).mockResolvedValue({ id: 'aud1' })
    await expect(startToolAudit(ENTRY)).resolves.toBe('aud1')
    expect((prisma.toolAuditLog.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      outcome: 'started',
      durationMs: null,
    })
  })
  it('start의 DB 실패는 throw한다(호출자가 실행하지 않도록)', async () => {
    ;(prisma.toolAuditLog.create as jest.Mock).mockRejectedValue(new Error('db'))
    await expect(startToolAudit(ENTRY)).rejects.toThrow(
      '감사 기록을 남길 수 없어 실행하지 않았습니다'
    )
  })
  it('finish의 DB 실패는 삼킨다(이미 실행된 쓰기를 다시 실행하지 않는다)', async () => {
    ;(prisma.toolAuditLog.update as jest.Mock).mockRejectedValue(new Error('db'))
    await expect(
      finishToolAudit('aud1', { outcome: 'ok', durationMs: 1, decryptedCredentialIds: [] })
    ).resolves.toBeUndefined()
  })
})
