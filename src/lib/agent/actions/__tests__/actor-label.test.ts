/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findMany: jest.fn() }, spaceAgent: { findMany: jest.fn() } },
}))
import { prisma } from '@/lib/prisma'
import { describeActors } from '../actor-label'

describe('describeActors', () => {
  beforeEach(() => {
    ;(prisma.user.findMany as jest.Mock).mockResolvedValue([
      { id: 'u1', name: '빛그림', email: 'b@x' },
    ])
    ;(prisma.spaceAgent.findMany as jest.Mock).mockResolvedValue([
      { id: 'ag1', name: '에밀리', kind: 'agent' },
    ])
  })
  it('에이전트 + 요청자', async () => {
    const [s] = await describeActors([
      { actorType: 'agent', actorId: 'ag1', requesterUserId: 'u1', requesterSlackUserId: 'U1' },
    ])
    expect(s).toBe('에이전트 에밀리 · 요청자 빛그림')
  })
  it('describeActor legacy worker', async () => {
    const [s] = await describeActors([
      { actorType: 'system', actorId: 'worker', requesterUserId: null, requesterSlackUserId: null },
    ])
    expect(s).toBe('시스템(워커)')
  })
  it('미확인 요청자는 Slack ID를 그대로 표시', async () => {
    const [s] = await describeActors([
      {
        actorType: 'system',
        actorId: 'workdeck-agent',
        requesterUserId: null,
        requesterSlackUserId: 'U9',
      },
    ])
    expect(s).toBe('워크덱 에이전트 · 요청자 미확인(Slack U9)')
  })
  it('삭제된 사용자·에이전트는 id 대신 "알 수 없음"', async () => {
    const [s] = await describeActors([
      { actorType: 'user', actorId: 'gone', requesterUserId: null, requesterSlackUserId: null },
    ])
    expect(s).toBe('구성원(알 수 없음)')
  })
  it('내장 에이전트가 OWNER User.id로 대신 기록한 system 행은 이름·id 대신 "시스템"', async () => {
    const [s] = await describeActors([
      { actorType: 'system', actorId: 'u1', requesterUserId: null, requesterSlackUserId: null },
    ])
    expect(s).toBe('시스템')
  })
  it('구성원이 직접 만든 행(요청자 = 행위자)은 이름 한 번만', async () => {
    const [s] = await describeActors([
      { actorType: 'user', actorId: 'u1', requesterUserId: 'u1', requesterSlackUserId: null },
    ])
    expect(s).toBe('빛그림')
  })
  it('rolling deploy 중 구버전이 쓴 legacy 행: User면 구성원, 아니면 시스템', async () => {
    const [a, b, c] = await describeActors([
      { actorType: 'legacy', actorId: 'u1', requesterUserId: null, requesterSlackUserId: null },
      { actorType: 'legacy', actorId: 'worker', requesterUserId: null, requesterSlackUserId: null },
      // 구버전 내장 에이전트가 OWNER User.id를 대신 기록한 행 — 삭제된 OWNER면 cuid 대신 "시스템"
      {
        actorType: 'legacy',
        actorId: 'cuid-gone',
        requesterUserId: null,
        requesterSlackUserId: null,
      },
    ])
    expect(a).toBe('빛그림')
    expect(b).toBe('시스템(워커)')
    expect(c).toBe('시스템')
  })
})
