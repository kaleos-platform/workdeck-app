/**
 * Slack interactive 테넌트 가드 e2e — 실 dev DB.
 * 실행 전제: .env.local(dev DB). 없으면 describe.skip.
 *
 * 검증:
 *  - 다른 Slack team(설치)이 남의 액션을 승인 시도 → 무시(상태 불변).
 *  - 올바른 team의 승인 → EXECUTED 전이.
 * interactive route를 HTTP로 태우는 대신, 라우트가 쓰는 것과 동일한 가드 로직·
 * approveAndExecute를 직접 조합해 테넌트 경계 불변식만 격리 검증한다.
 */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '@/lib/agent/actions/create'
import { approveAndExecute } from '@/lib/agent/actions/execute'
import { __registerActionForTest } from '@/lib/agent/actions/registry'
import type { ActionDefinition } from '@/lib/agent/actions/types'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

// 신규 식별자로 격리(다른 e2e와 충돌 방지).
const SPACE_A = 'e2e00000-0000-4000-8000-00000000slk1'
const SPACE_B = 'e2e00000-0000-4000-8000-00000000slk2'
const USER_ID = 'e2e00000-0000-4000-8000-00000000slk9'
const TEAM_A = 'Te2eSLACKA'
const TEAM_B = 'Te2eSLACKB'
const CHANNEL_A = 'Ce2eSLACKA'

const TEST_TYPE = 'test.slack.guard.noop'
let execCount = 0
const testAction: ActionDefinition = {
  actionType: TEST_TYPE,
  deckKey: 'finance',
  title: 'Slack 가드 테스트',
  paramsSchema: z.object({}),
  requiredRole: 'ADMIN',
  async execute() {
    execCount += 1
    return { ok: true }
  },
}

let unregister: Array<() => void> = []

// interactive route의 테넌트 가드를 재현한 순수 판정 함수.
async function isDecisionAllowed(input: {
  teamId: string
  channelId: string | undefined
  action: { spaceId: string; slackChannelId: string | null }
}): Promise<boolean> {
  const installation = await prisma.slackInstallation.findUnique({
    where: { teamId: input.teamId },
    select: { spaceId: true },
  })
  if (!installation || installation.spaceId !== input.action.spaceId) return false
  if (input.action.slackChannelId && input.channelId !== input.action.slackChannelId) return false
  return true
}

d('Slack interactive 테넌트 가드', () => {
  beforeAll(async () => {
    unregister.push(__registerActionForTest(testAction))
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-slack@throwaway.test', name: 'E2E Slack' },
    })
    for (const id of [SPACE_A, SPACE_B]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E Slack ${id}`, type: 'PERSONAL' },
      })
      await prisma.spaceMember.upsert({
        where: { spaceId_userId: { spaceId: id, userId: USER_ID } },
        update: {},
        create: { spaceId: id, userId: USER_ID, role: 'OWNER' },
      })
    }
    // Space A ↔ TEAM_A, Space B ↔ TEAM_B 설치. 토큰은 형식만 유효하면 됨(발송 안 함).
    await prisma.slackInstallation.upsert({
      where: { spaceId: SPACE_A },
      update: {},
      create: {
        spaceId: SPACE_A,
        teamId: TEAM_A,
        botUserId: 'U_A',
        botToken: 'deadbeef',
        botTokenIv: '00000000000000000000000000000000',
        installedBy: USER_ID,
      },
    })
    await prisma.slackInstallation.upsert({
      where: { spaceId: SPACE_B },
      update: {},
      create: {
        spaceId: SPACE_B,
        teamId: TEAM_B,
        botUserId: 'U_B',
        botToken: 'deadbeef',
        botTokenIv: '00000000000000000000000000000000',
        installedBy: USER_ID,
      },
    })
  })

  afterEach(async () => {
    execCount = 0
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
    await prisma.spaceSlackChannel.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
    await prisma.slackInstallation.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_A, SPACE_B] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    unregister.forEach((u) => u())
    unregister = []
    await prisma.$disconnect()
  })

  async function makeActionInA() {
    const r = await createPendingAction({
      spaceId: SPACE_A,
      actionType: TEST_TYPE,
      params: {},
      summary: 'Slack 가드',
      source: 'MCP',
      requestedBy: USER_ID,
    })
    // 알림 채널 좌표를 수동 세팅(발송 없이 채널 매칭 검증용).
    await prisma.agentPendingAction.update({
      where: { id: r.actionId },
      data: { slackChannelId: CHANNEL_A, slackMessageTs: '1700000000.000100' },
    })
    return r.actionId
  }

  test('다른 team(B)이 Space A 액션 결정 시도 → 차단(불변), execute 미실행', async () => {
    const actionId = await makeActionInA()
    const action = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: { spaceId: true, slackChannelId: true },
    })
    const allowed = await isDecisionAllowed({
      teamId: TEAM_B,
      channelId: CHANNEL_A,
      action: action!,
    })
    expect(allowed).toBe(false)
    // 가드가 막았으므로 approveAndExecute를 호출하지 않는다 → 여전히 PENDING.
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('PENDING')
    expect(execCount).toBe(0)
  })

  test('올바른 team(A)·채널 일치 → 허용 후 승인 → EXECUTED', async () => {
    const actionId = await makeActionInA()
    const action = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: { spaceId: true, slackChannelId: true },
    })
    const allowed = await isDecisionAllowed({
      teamId: TEAM_A,
      channelId: CHANNEL_A,
      action: action!,
    })
    expect(allowed).toBe(true)
    const out = await approveAndExecute(actionId, 'slack:U_A')
    expect(out.status).toBe('EXECUTED')
    expect(execCount).toBe(1)
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('EXECUTED')
    expect(row?.decidedBy).toBe('slack:U_A')
  })

  test('team은 맞으나 채널 불일치 → 차단', async () => {
    const actionId = await makeActionInA()
    const action = await prisma.agentPendingAction.findUnique({
      where: { id: actionId },
      select: { spaceId: true, slackChannelId: true },
    })
    const allowed = await isDecisionAllowed({
      teamId: TEAM_A,
      channelId: 'C_WRONG',
      action: action!,
    })
    expect(allowed).toBe(false)
  })
})
