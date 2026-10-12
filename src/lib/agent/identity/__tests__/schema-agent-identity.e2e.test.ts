/**
 * SpaceAgent(신원)·AgentToken 스키마 계약 — 실 DB.
 * 기존 토글(SpaceAgentSetting, 테이블 "SpaceAgent")과 공존하는지,
 * 같은 Space 안 이름 중복과 oauthClientId 중복이 막히는지 확인한다.
 */
import { prisma } from '@/lib/prisma'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000a1'

d('SpaceAgent 신원 스키마', () => {
  beforeAll(async () => {
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Agent Identity', type: 'ORGANIZATION' },
    })
  })
  afterAll(async () => {
    await prisma.space.delete({ where: { id: SPACE_ID } }).catch(() => undefined)
  })

  it('토글(SpaceAgentSetting)과 신원(SpaceAgent)이 같은 Space에 공존한다', async () => {
    await prisma.spaceAgentSetting.upsert({
      where: { spaceId: SPACE_ID },
      update: { isActive: false },
      create: { spaceId: SPACE_ID, isActive: false },
    })
    const agent = await prisma.spaceAgent.create({
      data: { spaceId: SPACE_ID, name: '에밀리', kind: 'agent', scopes: ['ads:read'] },
    })
    expect(agent.status).toBe('ACTIVE')
    const token = await prisma.agentToken.create({
      data: { agentId: agent.id, tokenHash: 'a'.repeat(64) },
    })
    expect(token.revokedAt).toBeNull()
  })

  it('같은 Space 안 이름 중복은 거부된다', async () => {
    await expect(
      prisma.spaceAgent.create({
        data: { spaceId: SPACE_ID, name: '에밀리', kind: 'agent', scopes: [] },
      })
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('oauthClientId는 전역 유일하다', async () => {
    await prisma.spaceAgent.create({
      data: {
        spaceId: SPACE_ID,
        name: 'Claude 공용',
        kind: 'integration',
        scopes: [],
        oauthClientId: 'cid-1',
      },
    })
    await expect(
      prisma.spaceAgent.create({
        data: {
          spaceId: SPACE_ID,
          name: 'Claude 공용2',
          kind: 'integration',
          scopes: [],
          oauthClientId: 'cid-1',
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})
