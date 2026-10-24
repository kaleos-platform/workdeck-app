/**
 * wd run ENV 발급 API — 실 DB. 다른 Space·API_KEY·만료 행은 403, 정상 행은 실제 복호화·감사 행.
 */
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { issueAgentToken } from '@/lib/agent/identity/agent-token'
import { saveEnvSecret, saveApiKeySecret } from '@/lib/agent/secrets/store'
import { POST } from '../../../../../app/api/secrets/env/route'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const A = 'e2e00000-0000-4000-8000-0000000000e6'
const B = 'e2e00000-0000-4000-8000-0000000000e7'
const UID = 'e2e00000-0000-4000-8000-0000000000e8'
const KEY = 'SK_TEST_0123456789abcdef'
const future = () => new Date(Date.now() + 30 * 86_400_000).toISOString()
const envCfg = (envName: string) => ({
  envName,
  scopeNote: 'e2e',
  expiresAt: future(),
  readOnlyConfirmedById: UID,
  readOnlyConfirmedAt: new Date().toISOString(),
})

let agentId = ''
let token = ''
const call = (secrets: string[]) =>
  POST(
    new NextRequest('http://t/api/secrets/env', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ secrets }),
    })
  )

d('POST /api/secrets/env (실 DB)', () => {
  beforeAll(async () => {
    // .env.local에 필드 암호화 키가 없으면 이 실행 동안만 쓰는 임시 키(이 테스트가 만든 행만 읽는다).
    process.env.ENCRYPTION_KEY_V1 ??= crypto.randomBytes(32).toString('hex')
    await prisma.user.upsert({
      where: { id: UID },
      update: {},
      create: { id: UID, email: 'e2e-env-issue@example.invalid' },
    })
    for (const id of [A, B]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E ${id}`, type: 'ORGANIZATION' },
      })
    }
    await prisma.spaceAgentSetting.upsert({
      where: { spaceId: A },
      update: { envSecretsEnabled: true },
      create: { spaceId: A, envSecretsEnabled: true },
    })
    const agent = await prisma.spaceAgent.create({
      data: { spaceId: A, name: 'e2e-env-agent', kind: 'agent', scopes: ['secret:env'] },
      select: { id: true },
    })
    agentId = agent.id
    token = (await issueAgentToken(agentId, { expiresInDays: 1 })).token

    await saveEnvSecret(A, 'ok-key', KEY, envCfg('OK_TOKEN'), [agentId], UID)
    // 같은 이름·같은 에이전트 id를 허용해도 다른 Space 행은 쓸 수 없다.
    await saveEnvSecret(B, 'other-space', KEY, envCfg('OTHER_TOKEN'), [agentId], UID)
    await saveApiKeySecret(
      A,
      'api-key',
      KEY,
      {
        baseUrl: 'https://api.example.com',
        auth: { in: 'header', name: 'Authorization', template: 'Bearer {value}' },
        readOps: [],
      },
      [agentId],
      UID
    )
    // 만료가 지난 ENV 행 — 등록 API 검증을 거치지 않고 직접 만든다.
    const saved = await saveEnvSecret(A, 'expired-key', KEY, envCfg('EXP_TOKEN'), [agentId], UID)
    await prisma.spaceSecret.update({
      where: { id: saved.id },
      data: { config: { ...envCfg('EXP_TOKEN'), expiresAt: '2020-01-01T00:00:00.000Z' } },
    })
  })
  afterAll(async () => {
    // SpaceSecret·SpaceAgent·AgentToken·ToolAuditLog·설정은 Space cascade로 지워진다.
    await prisma.space.deleteMany({ where: { id: { in: [A, B] } } })
    await prisma.user.deleteMany({ where: { id: UID } })
    await prisma.$disconnect()
  })

  it('다른 Space의 ENV 비밀값은 403', async () => {
    const res = await call(['other-space'])
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain(KEY)
  })

  it('API_KEY 비밀값은 이 경로에서 403', async () => {
    const res = await call(['api-key'])
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain(KEY)
  })

  it('만료가 지난 ENV 행은 403', async () => {
    const res = await call(['ok-key', 'expired-key'])
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ message: '사용할 수 없는 비밀값: expired-key' })
  })

  it('정상 ENV 행은 복호화해 env로 주고 감사 행에 secret:<id>를 남긴다', async () => {
    const res = await call(['ok-key'])
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ env: { OK_TOKEN: KEY } })
    const row = await prisma.spaceSecret.findUniqueOrThrow({
      where: { spaceId_name: { spaceId: A, name: 'ok-key' } },
      select: { id: true },
    })
    const audit = await prisma.toolAuditLog.findFirstOrThrow({
      where: { spaceId: A, tool: 'secret_env_issue', outcome: 'ok' },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit.actorType).toBe('agent')
    expect(audit.actorId).toBe(agentId)
    expect(audit.decryptedCredentialIds).toEqual([`secret:${row.id}`])
    expect(audit.argsSummary).toBe('{"names":["ok-key"]}')
    expect(JSON.stringify(audit)).not.toContain(KEY)
  })
})
