/** createPendingAction이 행위자·요청자·workId를 저장하는지, 요청자 변환이 Space 경계를 지키는지 — 실 DB */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { __registerActionForTest } from '../registry'
import { resolveRequester } from '@/lib/agent/requester'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e1'
const OTHER_SPACE_ID = 'e2e00000-0000-4000-8000-0000000000e4'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000e5'
const TEST_TYPE = 'test.actor.noop'
let unregister: () => void = () => undefined

d('AgentPendingAction 행위자 컬럼', () => {
  beforeAll(async () => {
    unregister = __registerActionForTest({
      actionType: TEST_TYPE,
      deckKey: 'finance',
      title: 't',
      paramsSchema: z.object({}),
      requiredRole: 'ADMIN',
      execute: async () => null,
    })
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-actor@throwaway.test', name: 'E2E Actor' },
    })
    for (const id of [SPACE_ID, OTHER_SPACE_ID]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: 'E2E Actor', type: 'PERSONAL' },
      })
    }
    // 다른 Space에서만 Slack 연결된 구성원
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: OTHER_SPACE_ID, userId: USER_ID } },
      update: { slackUserId: 'UE2EOTHER' },
      create: { spaceId: OTHER_SPACE_ID, userId: USER_ID, role: 'OWNER', slackUserId: 'UE2EOTHER' },
    })
  })
  afterAll(async () => {
    unregister()
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => undefined)
    await prisma.$disconnect()
  })

  it('에이전트 제안 + 미확인 요청자', async () => {
    const r = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: TEST_TYPE,
      params: {},
      summary: 'e2e',
      source: 'MCP',
      actor: { type: 'agent', id: 'ag-e2e' },
      requesterUserId: null,
      requesterSlackUserId: 'U999',
      workId: 'wk_e2e_actor',
    })
    const row = await prisma.agentPendingAction.findUnique({ where: { id: r.actionId } })
    expect(row).toMatchObject({
      actorType: 'agent',
      actorId: 'ag-e2e',
      requesterUserId: null,
      requesterSlackUserId: 'U999',
      workId: 'wk_e2e_actor',
    })
  })

  it('다른 Space에서만 연결된 Slack 사용자 → 이 Space에서는 요청자 null(원문 ID만)', async () => {
    await expect(resolveRequester(SPACE_ID, 'UE2EOTHER')).resolves.toEqual({
      requesterUserId: null,
      requesterSlackUserId: 'UE2EOTHER',
    })
    await expect(resolveRequester(OTHER_SPACE_ID, 'UE2EOTHER')).resolves.toEqual({
      requesterUserId: USER_ID,
      requesterSlackUserId: 'UE2EOTHER',
    })
  })
})
