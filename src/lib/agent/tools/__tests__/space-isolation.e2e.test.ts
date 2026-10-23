/**
 * Space 격리 — 실 DB. 에이전트 컨텍스트(spaceId=B)로 A의 데이터가 보이지 않아야 한다.
 * Workspace가 연결되지 않은 Space에서 쿠팡 도구는 명시 오류를 낸다.
 */
import { prisma } from '@/lib/prisma'
import { toolDefinitions } from '../index'
import { runTool } from '../run-tool'
import type { McpToolContext } from '../types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const A = 'e2e00000-0000-4000-8000-0000000000c1'
const B = 'e2e00000-0000-4000-8000-0000000000c2'
const tool = (n: string) => toolDefinitions.find((t) => t.name === n)!

const agentCtx = (spaceId: string): McpToolContext => ({
  spaceId,
  actor: { type: 'agent', id: 'ag-e2e' },
  scopes: ['finance:read', 'ads:read'],
  workId: 'wk_e2e',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
})

d('Space 격리', () => {
  beforeAll(async () => {
    for (const [id, acct] of [
      [A, `${A}-acct`],
      [B, `${B}-acct`],
    ] as const) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E ${id}`, type: 'ORGANIZATION' },
      })
      await prisma.deckInstance.upsert({
        where: { spaceId_deckAppId: { spaceId: id, deckAppId: 'finance' } },
        update: { isActive: true },
        create: { spaceId: id, deckAppId: 'finance', isActive: true },
      })
      await prisma.finAccount.upsert({
        where: { id: acct },
        update: {},
        create: { id: acct, spaceId: id, name: `계좌 ${id}`, kind: 'BANK', institution: '테스트' },
      })
    }
  })
  afterAll(async () => {
    await prisma.space.deleteMany({ where: { id: { in: [A, B] } } })
    await prisma.$disconnect()
  })

  it('wrong Space data invisible: B 컨텍스트로 A 계좌가 보이지 않는다', async () => {
    const res = (await runTool(tool('finance_list_accounts'), agentCtx(B), {})) as {
      accounts: Array<{ id: string }>
    }
    const ids = res.accounts.map((a) => a.id)
    expect(ids).toContain(`${B}-acct`)
    expect(ids).not.toContain(`${A}-acct`)
  })

  it('Workspace가 연결되지 않은 Space → 쿠팡 도구는 명시 오류', async () => {
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId: B, deckAppId: 'coupang-ads' } },
      update: { isActive: true },
      create: { spaceId: B, deckAppId: 'coupang-ads', isActive: true },
    })
    await expect(
      runTool(tool('ads_get_kpi'), agentCtx(B), { startDate: '2026-10-01', endDate: '2026-10-07' })
    ).rejects.toThrow('쿠팡 워크스페이스가 이 Space에 연결되어 있지 않습니다')
  })

  it('Space A 에이전트가 Space B의 같은 이름 비밀값을 쓰면 거부된다', async () => {
    const uid = 'e2e00000-0000-4000-8000-0000000000d1'
    try {
      await prisma.user.upsert({
        where: { id: uid },
        update: {},
        create: { id: uid, email: 'e2e-secret-isolation@example.invalid' },
      })
      await prisma.spaceSecret.create({
        data: {
          spaceId: B,
          name: 'e2e-shared-name',
          kind: 'API_KEY',
          encryptedPayload: 'x',
          iv: 'x',
          config: {},
          allowedAgentIds: ['ag-e2e'],
          createdById: uid,
        },
      })
      await expect(
        runTool(
          tool('secret_http_read'),
          { ...agentCtx(A), scopes: ['secret:read'] },
          { secret: 'e2e-shared-name', op: 'x', path: '/x' }
        )
      ).rejects.toThrow('사용할 수 없는 비밀값입니다')
    } finally {
      await prisma.spaceSecret.deleteMany({ where: { spaceId: B, name: 'e2e-shared-name' } })
      await prisma.user.deleteMany({ where: { id: uid } })
    }
  })
})
