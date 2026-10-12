/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { toolAuditLog: { create: jest.fn(), update: jest.fn() } },
}))
import { prisma } from '@/lib/prisma'
import { finishToolAudit, maskSecrets, startToolAudit, summarizeArgs } from '../audit'

const ENTRY = {
  spaceId: 'sp1',
  workId: 'wk',
  actor: { type: 'agent' as const, id: 'ag1' },
  requesterUserId: null,
  tool: 't',
  args: {},
}

describe('audit', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
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
  it.each([
    ['credentials'],
    ['privateKey'],
    ['private_key'],
    ['accessKey'],
    ['auth'],
    ['sessionId'],
  ])('키 %s 값은 마스킹', (key) => {
    const s = summarizeArgs({ [key]: 'S3CRET', keep: 'ok' })
    expect(s).not.toContain('S3CRET')
    expect(s).toContain('ok')
  })
  it('auth가 들어간 일반 키(author)는 마스킹하지 않는다', () => {
    expect(summarizeArgs({ author: 'kim' })).toContain('kim')
  })
  it('Bearer 값과 URL의 access_token=·token=은 키 이름과 무관하게 마스킹', () => {
    const s = summarizeArgs({
      header: 'Bearer EAABxyz',
      url: 'https://graph.facebook.com/v19.0/me?fields=id&access_token=EAAB123&x=1',
      q: 'token=abc123',
    })
    expect(s).not.toContain('EAABxyz')
    expect(s).not.toContain('EAAB123')
    expect(s).not.toContain('abc123')
    expect(s).toContain('fields=id')
    expect(s).toContain('x=1')
  })
  it('문자열 안에 든 JSON의 "access_token":"…"도 마스킹', () => {
    expect(maskSecrets('{"access_token": "EAAB777","id":"1"}')).toBe(
      '{"access_token": "[redacted]","id":"1"}'
    )
  })

  it('긴 입력에서도 선형 시간에 끝난다(정규식 역추적 방지)', () => {
    const t0 = Date.now()
    maskSecrets('a'.repeat(200000))
    maskSecrets('"'.concat('a'.repeat(200000)))
    expect(Date.now() - t0).toBeLessThan(500)
    expect(maskSecrets('https://x?access_token=SECRET&a=1')).toBe(
      'https://x?access_token=[redacted]&a=1'
    )
  })
  it('감사 error 칸에도 같은 값 마스킹을 적용한다', async () => {
    ;(prisma.toolAuditLog.create as jest.Mock).mockResolvedValue({ id: 'aud1' })
    ;(prisma.toolAuditLog.update as jest.Mock).mockResolvedValue({})
    await startToolAudit({ ...ENTRY, outcome: 'denied', error: 'Bearer wdk_agt_a.b denied' })
    await finishToolAudit('aud1', {
      outcome: 'error',
      error: 'Error: GET /x?access_token=EAAB999 401',
      durationMs: 1,
      decryptedCredentialIds: [],
    })
    const startErr = (prisma.toolAuditLog.create as jest.Mock).mock.calls.at(-1)[0].data.error
    const finishErr = (prisma.toolAuditLog.update as jest.Mock).mock.calls.at(-1)[0].data.error
    expect(startErr).not.toContain('wdk_agt_a')
    expect(finishErr).not.toContain('EAAB999')
    expect(finishErr).toBe(maskSecrets('Error: GET /x?access_token=EAAB999 401'))
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
