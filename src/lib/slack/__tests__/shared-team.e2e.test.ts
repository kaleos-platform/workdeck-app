/**
 * 한 Slack team을 두 Space가 공유 — 실 DB(로컬 Supabase).
 *  - 이벤트: 채널 X → Space1, Y → Space2, 미등록 채널 → unmapped
 *  - 승인 가드: team이 pending Space에 설치된 경우만 통과, 채널이 다르면 거부
 *  - 채널 소유: 다른 Space가 등록한 채널 판정
 *  - 한 Space 연결 해제(행 삭제)가 다른 Space의 설치·채널을 지우지 않는다
 *  - 설치가 하나가 되어도 등록된 채널에서만 응답한다(떠난 Space의 채널 → 남은 Space 아님)
 *  - 재연결(team 변경)과 채널 등록이 동시에 와도 새 team의 다른 Space 채널을 가져가지 못한다(Space 설치 lock)
 *  - 무관한 두 Space가 같은 team에 동시에 첫 설치해도 하나만 붙는다(team lock 안의 sibling 판정)
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { appendConversation, loadConversation } from '@/lib/agent/llm/conversation'
import {
  findChannelOwnedByOtherSpace,
  findTeamInstallationForSpace,
  isChannelRegisteredToSpace,
  registerSpaceChannel,
  resolveEventSpace,
} from '../tenant'
import { GET as oauthCallback } from '../../../../app/api/slack/oauth/callback/route'

// 실제 콜백 핸들러를 실DB로 돌린다. Slack 교환·state 서명·암호화만 mock한다(로직 복제 없음).
jest.mock('@/lib/domain', () => ({ buildAppUrl: (path: string) => `https://app.test${path}` }))
// state 'sp6'/'sp7'은 첫 설치 경합용(재연결 아님), 그 밖('s')은 SP4 재연결.
jest.mock('@/lib/slack/state', () => ({
  verifyState: (s: string) => ({
    spaceId:
      s === 'sp6'
        ? 'e2e00000-0000-4000-8000-0000000shrd6'
        : s === 'sp7'
          ? 'e2e00000-0000-4000-8000-0000000shrd7'
          : 'e2e00000-0000-4000-8000-0000000shrd4',
    userId: 'e2e00000-0000-4000-8000-0000000shrd9',
    reconnect: s === 's',
  }),
}))
// code 'first' → 아직 아무 Space도 쓰지 않는 team, 그 밖 → RACE2.
jest.mock('@/lib/slack/client', () => ({
  oauthV2Access: jest.fn(async (code: string) => ({
    ok: true,
    access_token: 'xoxb-race',
    bot_user_id: 'UBOT',
    scope: 'chat:write',
    team:
      code === 'first' ? { id: 'Te2eFIRST', name: 'First' } : { id: 'Te2eRACE2', name: 'Race2' },
  })),
}))
jest.mock('@/lib/slack/token-crypto', () => ({
  encryptBotToken: () => ({ token: 'enc', iv: 'v1' }),
}))

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SP1 = 'e2e00000-0000-4000-8000-0000000shrd1'
const SP2 = 'e2e00000-0000-4000-8000-0000000shrd2'
const SP3 = 'e2e00000-0000-4000-8000-0000000shrd3' // 다른 team
const USER_ID = 'e2e00000-0000-4000-8000-0000000shrd9'
const TEAM = 'Te2eSHARED'
const TEAM_OTHER = 'Te2eOTHER'
const CH_X = 'Ce2eSHRDX'
const CH_Y = 'Ce2eSHRDY'
const CH_Z = 'Ce2eSHRDZ' // 동시 등록 경합용
const THREAD = '1700000000.000100'

async function install(spaceId: string, teamId: string) {
  await prisma.slackInstallation.create({
    data: {
      spaceId,
      teamId,
      botUserId: 'UBOT',
      botToken: 'deadbeef',
      botTokenIv: 'v1',
      installedBy: USER_ID,
    },
  })
}

d('한 Slack team을 두 Space가 공유', () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-shared-team@throwaway.test', name: 'E2E Shared' },
    })
    for (const id of [SP1, SP2, SP3]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E ${id}`, type: 'PERSONAL' },
      })
    }
    await install(SP1, TEAM)
    await install(SP2, TEAM) // teamId @unique였다면 여기서 P2002
    await install(SP3, TEAM_OTHER)
    await prisma.spaceSlackChannel.create({
      data: { spaceId: SP1, channelId: CH_X, kind: 'approvals' },
    })
    await prisma.spaceSlackChannel.create({
      data: { spaceId: SP2, channelId: CH_Y, kind: 'approvals' },
    })
  })

  afterAll(async () => {
    await prisma.agentConversation.deleteMany({ where: { spaceId: { in: [SP1, SP2, SP3] } } })
    await prisma.spaceSlackChannel.deleteMany({ where: { spaceId: { in: [SP1, SP2, SP3] } } })
    await prisma.slackInstallation.deleteMany({ where: { spaceId: { in: [SP1, SP2, SP3] } } })
    await prisma.space.deleteMany({ where: { id: { in: [SP1, SP2, SP3] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
  })

  test('이벤트: 채널 X → Space1, Y → Space2, 미등록 → unmapped', async () => {
    const x = await resolveEventSpace(TEAM, CH_X)
    const y = await resolveEventSpace(TEAM, CH_Y)
    expect(x.status === 'routed' && x.installation.spaceId).toBe(SP1)
    expect(y.status === 'routed' && y.installation.spaceId).toBe(SP2)
    expect((await resolveEventSpace(TEAM, 'Ce2eNOPE')).status).toBe('unmapped')
  })

  test('승인 가드: team이 pending Space에 설치된 경우만 통과', async () => {
    expect(await findTeamInstallationForSpace(SP1, TEAM)).not.toBeNull()
    expect(await findTeamInstallationForSpace(SP2, TEAM)).not.toBeNull()
    expect(await findTeamInstallationForSpace(SP1, TEAM_OTHER)).toBeNull() // 다른 team이 Space1 액션을 누름
    expect(await findTeamInstallationForSpace(SP3, TEAM)).toBeNull() // Space3에는 이 team이 없음
  })

  test('채널 소유: Space2 입장에서 X는 다른 Space 채널, Y는 아님', async () => {
    expect(
      await findChannelOwnedByOtherSpace({ teamId: TEAM, channelId: CH_X, spaceId: SP2 })
    ).toBe(true)
    expect(
      await findChannelOwnedByOtherSpace({ teamId: TEAM, channelId: CH_Y, spaceId: SP2 })
    ).toBe(false)
    expect(
      await findChannelOwnedByOtherSpace({ teamId: TEAM_OTHER, channelId: CH_X, spaceId: SP3 })
    ).toBe(false)
  })

  test('동시 등록 경합: 두 Space가 같은 순간 같은 채널을 등록하면 하나만 성공', async () => {
    const results = await Promise.all([
      registerSpaceChannel({
        spaceId: SP1,
        channelId: CH_Z,
        channelName: null,
        kind: 'notifications',
      }),
      registerSpaceChannel({
        spaceId: SP2,
        channelId: CH_Z,
        channelName: null,
        kind: 'notifications',
      }),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await prisma.spaceSlackChannel.count({ where: { channelId: CH_Z } })).toBe(1)
  })

  test('한 Space는 같은 채널을 승인·알림 두 용도로 함께 등록할 수 있다', async () => {
    const r = await registerSpaceChannel({
      spaceId: SP3,
      channelId: 'Ce2eSHRDW',
      channelName: null,
      kind: 'approvals',
    })
    const r2 = await registerSpaceChannel({
      spaceId: SP3,
      channelId: 'Ce2eSHRDW',
      channelName: null,
      kind: 'notifications',
    })
    expect(r.ok && r2.ok).toBe(true)
  })

  test('agent 채널은 Space당 여러 개, approvals는 1개로 교체, 같은 행 중복은 DB unique가 막는다', async () => {
    const reg = (channelId: string, kind: string) =>
      registerSpaceChannel({ spaceId: SP3, channelId, channelName: null, kind })
    expect((await reg('Ce2eAGT1', 'agent')).ok).toBe(true)
    expect((await reg('Ce2eAGT2', 'agent')).ok).toBe(true)
    expect((await reg('Ce2eAGT1', 'agent')).ok).toBe(true) // 재등록은 같은 행
    expect(await prisma.spaceSlackChannel.count({ where: { spaceId: SP3, kind: 'agent' } })).toBe(2)

    expect((await reg('Ce2eAPRV', 'approvals')).ok).toBe(true) // 앞 테스트의 W를 교체
    const approvals = await prisma.spaceSlackChannel.findMany({
      where: { spaceId: SP3, kind: 'approvals' },
    })
    expect(approvals.map((c) => c.channelId)).toEqual(['Ce2eAPRV'])

    await expect(
      prisma.spaceSlackChannel.create({
        data: { spaceId: SP3, channelId: 'Ce2eAGT1', kind: 'agent' },
      })
    ).rejects.toMatchObject({ code: 'P2002' })

    // agent 채널도 inbound 라우팅·slack_post 허용 대상이다
    const r = await resolveEventSpace(TEAM_OTHER, 'Ce2eAGT2')
    expect(r.status === 'routed' && r.installation.spaceId).toBe(SP3)
    expect(
      await isChannelRegisteredToSpace({ teamId: TEAM_OTHER, channelId: 'Ce2eAGT2', spaceId: SP3 })
    ).toBe(true)
  })

  test('다른 Space가 등록한 채널은 agent 용도로도 등록할 수 없다', async () => {
    await expect(
      registerSpaceChannel({ spaceId: SP2, channelId: CH_X, channelName: null, kind: 'agent' })
    ).resolves.toEqual({ ok: false, reason: 'taken' })
    expect(await isChannelRegisteredToSpace({ teamId: TEAM, channelId: CH_X, spaceId: SP2 })).toBe(
      false
    )
  })

  test('채널 소유 변경 후 기존 스레드 재사용: 이전 Space의 대화 기록이 새 Space로 넘어가지 않는다', async () => {
    await appendConversation({
      spaceId: SP1,
      channelId: CH_X,
      threadTs: THREAD,
      userText: 'Space1 비밀',
      assistantText: 'Space1 답',
    })
    // 소유 변경: Space1이 X를 놓고 Space2가 등록
    await prisma.spaceSlackChannel.deleteMany({ where: { spaceId: SP1, channelId: CH_X } })
    await expect(
      registerSpaceChannel({
        spaceId: SP2,
        channelId: CH_X,
        channelName: null,
        kind: 'notifications',
      })
    ).resolves.toMatchObject({ ok: true })
    await expect(loadConversation(SP2, CH_X, THREAD)).resolves.toEqual([])
    await appendConversation({
      spaceId: SP2,
      channelId: CH_X,
      threadTs: THREAD,
      userText: 'q',
      assistantText: 'a',
    })
    const row = await prisma.agentConversation.findUnique({
      where: { channelId_threadTs: { channelId: CH_X, threadTs: THREAD } },
    })
    expect(row?.spaceId).toBe(SP2)
    expect(JSON.stringify(row?.messages)).not.toContain('Space1 비밀')
  })

  test('Space1 연결 해제가 Space2의 설치·채널을 지우지 않는다', async () => {
    // CH_X를 다시 Space1 채널로 만든다(앞 테스트에서 Space2로 넘어갔던 것을 되돌림).
    await prisma.spaceSlackChannel.deleteMany({ where: { spaceId: SP2, channelId: CH_X } })
    await expect(
      registerSpaceChannel({ spaceId: SP1, channelId: CH_X, channelName: null, kind: 'approvals' })
    ).resolves.toMatchObject({ ok: true })
    await prisma.slackInstallation.delete({ where: { spaceId: SP1 } })
    expect(await prisma.spaceSlackChannel.count({ where: { spaceId: SP1 } })).toBe(0) // Cascade
    expect(await prisma.slackInstallation.findUnique({ where: { spaceId: SP2 } })).not.toBeNull()
    expect(await prisma.spaceSlackChannel.count({ where: { spaceId: SP2, channelId: CH_Y } })).toBe(
      1
    )
    const y = await resolveEventSpace(TEAM, CH_Y)
    expect(y.status === 'routed' && y.installation.spaceId).toBe(SP2)
  })

  test('2→1 전이 뒤 떠난 Space의 채널은 남은 Space로 가지 않는다(등록해야만 간다)', async () => {
    // 앞 테스트로 TEAM 설치는 SP2 하나. CH_X는 떠난 SP1의 채널이었다.
    expect(await prisma.slackInstallation.count({ where: { teamId: TEAM } })).toBe(1)
    const before = await resolveEventSpace(TEAM, CH_X)
    expect(before.status).toBe('unmapped')
    expect(before).not.toHaveProperty('installation')
    expect((await resolveEventSpace(TEAM, 'Ce2eNOPE')).status).toBe('unmapped')

    await expect(
      registerSpaceChannel({
        spaceId: SP2,
        channelId: CH_X,
        channelName: null,
        kind: 'notifications',
      })
    ).resolves.toMatchObject({ ok: true })
    const after = await resolveEventSpace(TEAM, CH_X)
    expect(after.status === 'routed' && after.installation.spaceId).toBe(SP2)
  })
})

d('재연결과 채널 등록 경합(같은 Space 설치 lock)', () => {
  // SP4는 RACE1 team, SP5는 RACE2 team이고 CH_R을 소유한다. SP4를 RACE2로 재연결하는 동시에 SP4가 CH_R을 등록한다.
  const SP4 = 'e2e00000-0000-4000-8000-0000000shrd4'
  const SP5 = 'e2e00000-0000-4000-8000-0000000shrd5'
  const CH_R = 'Ce2eRACE'

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-shared-team@throwaway.test', name: 'E2E Shared' },
    })
    for (const id of [SP4, SP5]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E ${id}`, type: 'PERSONAL' },
      })
    }
    await install(SP4, 'Te2eRACE1')
    await install(SP5, 'Te2eRACE2')
    await prisma.spaceSlackChannel.create({
      data: { spaceId: SP5, channelId: CH_R, kind: 'approvals' },
    })
    // 콜백의 team_conflict 검사 통과용: 재연결하는 사람이 RACE2를 쓰는 SP5의 ADMIN
    await prisma.spaceMember.create({ data: { spaceId: SP5, userId: USER_ID, role: 'ADMIN' } })
  })

  afterAll(async () => {
    await prisma.spaceMember.deleteMany({ where: { spaceId: { in: [SP4, SP5] } } })
    await prisma.spaceSlackChannel.deleteMany({ where: { spaceId: { in: [SP4, SP5] } } })
    await prisma.slackInstallation.deleteMany({ where: { spaceId: { in: [SP4, SP5] } } })
    await prisma.space.deleteMany({ where: { id: { in: [SP4, SP5] } } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
  })

  test('어느 쪽이 먼저 끝나도 SP4는 CH_R을 갖지 못하고, CH_R 소유는 SP5 하나', async () => {
    const [res] = await Promise.all([
      oauthCallback(new NextRequest('https://app.test/api/slack/oauth/callback?code=c&state=s')),
      registerSpaceChannel({
        spaceId: SP4,
        channelId: CH_R,
        channelName: null,
        kind: 'notifications',
      }),
    ])
    expect(res.headers.get('location')).toBe(
      `https://app.test/settings/integrations?slack=connected&spaceId=${SP4}`
    )
    expect(await prisma.slackInstallation.findUnique({ where: { spaceId: SP4 } })).toMatchObject({
      teamId: 'Te2eRACE2',
    })
    // 등록이 먼저면 재연결이 지우고, 재연결이 먼저면 등록이 RACE2로 다시 검사해 taken. 밖에서 읽은 RACE1로 검사하면 SP4 행이 남는다.
    expect(await prisma.spaceSlackChannel.count({ where: { spaceId: SP4, channelId: CH_R } })).toBe(
      0
    )
    expect(await prisma.spaceSlackChannel.count({ where: { channelId: CH_R } })).toBe(1)
  })
})

d('같은 team 동시 첫 설치(team lock)', () => {
  // SP6, SP7은 서로 무관(설치자가 어느 쪽의 구성원도 아님). 둘이 동시에 Te2eFIRST를 처음 설치한다.
  const SP6 = 'e2e00000-0000-4000-8000-0000000shrd6'
  const SP7 = 'e2e00000-0000-4000-8000-0000000shrd7'

  beforeAll(async () => {
    for (const id of [SP6, SP7]) {
      await prisma.space.upsert({
        where: { id },
        update: {},
        create: { id, name: `E2E ${id}`, type: 'PERSONAL' },
      })
    }
  })

  afterAll(async () => {
    await prisma.slackInstallation.deleteMany({ where: { spaceId: { in: [SP6, SP7] } } })
    await prisma.space.deleteMany({ where: { id: { in: [SP6, SP7] } } })
  })

  test('하나만 connected, 다른 하나는 team_conflict — team 설치는 1행', async () => {
    const results = await Promise.all(
      ['sp6', 'sp7'].map((st) =>
        oauthCallback(
          new NextRequest(`https://app.test/api/slack/oauth/callback?code=first&state=${st}`)
        )
      )
    )
    const statuses = results.map((r) =>
      new URL(r.headers.get('location')!).searchParams.get('slack')
    )
    expect(statuses.sort()).toEqual(['connected', 'team_conflict'])
    expect(await prisma.slackInstallation.count({ where: { teamId: 'Te2eFIRST' } })).toBe(1)
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
