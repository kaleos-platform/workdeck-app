/**
 * Phase 4 승인 API e2e — 실 dev DB + 실제 route 핸들러.
 * getUser만 mock한다. 핵심: cross-space IDOR 차단(다른 space ADMIN이 승인 불가).
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { __registerActionForTest } from '../registry'
import type { ActionDefinition } from '../types'
import { z } from 'zod'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

// getUser mock — mutable caller.
let mockUserId: string | null = null
jest.mock('@/hooks/use-user', () => ({
  getUser: async () => (mockUserId ? { id: mockUserId } : null),
}))

// 핸들러는 mock 이후 import.
import { PATCH, GET as getOne } from '../../../../../app/api/agent/actions/[actionId]/route'

const SPACE_A = 'e2e00000-0000-4000-8000-0000000000c1'
const SPACE_B = 'e2e00000-0000-4000-8000-0000000000c2'
const ADMIN_A = 'e2e00000-0000-4000-8000-0000000000c3'
const ADMIN_B = 'e2e00000-0000-4000-8000-0000000000c4'
const MEMBER_A = 'e2e00000-0000-4000-8000-0000000000c5'

let execCount = 0
const TEST_TYPE = 'test.api.noop'
const testAction: ActionDefinition = {
  actionType: TEST_TYPE,
  deckKey: 'finance',
  title: '테스트',
  paramsSchema: z.object({}),
  requiredRole: 'ADMIN',
  async execute() {
    execCount += 1
    return { ok: true }
  },
}
let unregister: () => void

function patchReq(action: 'approve' | 'reject') {
  return new NextRequest('http://localhost/api/agent/actions/x', {
    method: 'PATCH',
    body: JSON.stringify({ action }),
  })
}

async function makeActionInSpace(spaceId: string, requestedBy: string) {
  return createPendingAction({
    spaceId,
    actionType: TEST_TYPE,
    params: {},
    summary: '테스트',
    source: 'MCP',
    requestedBy,
  })
}

d('승인 API — cross-space IDOR', () => {
  beforeAll(async () => {
    unregister = __registerActionForTest(testAction)
    for (const [uid, email] of [
      [ADMIN_A, 'e2e-adminA@throwaway.test'],
      [ADMIN_B, 'e2e-adminB@throwaway.test'],
      [MEMBER_A, 'e2e-memberA@throwaway.test'],
    ] as const) {
      await prisma.user.upsert({
        where: { id: uid },
        update: {},
        create: { id: uid, email, name: uid },
      })
    }
    for (const sid of [SPACE_A, SPACE_B]) {
      await prisma.space.upsert({
        where: { id: sid },
        update: {},
        create: { id: sid, name: `E2E ${sid}`, type: 'PERSONAL' },
      })
    }
    // ADMIN_A → Space A(ADMIN), ADMIN_B → Space B(ADMIN), MEMBER_A → Space A(MEMBER)
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_A, userId: ADMIN_A } },
      update: { role: 'ADMIN' },
      create: { spaceId: SPACE_A, userId: ADMIN_A, role: 'ADMIN' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_B, userId: ADMIN_B } },
      update: { role: 'ADMIN' },
      create: { spaceId: SPACE_B, userId: ADMIN_B, role: 'ADMIN' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_A, userId: MEMBER_A } },
      update: { role: 'MEMBER' },
      create: { spaceId: SPACE_A, userId: MEMBER_A, role: 'MEMBER' },
    })
  })

  afterEach(async () => {
    execCount = 0
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
  })

  afterAll(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: { in: [SPACE_A, SPACE_B] } } })
    await prisma.space.deleteMany({ where: { id: { in: [SPACE_A, SPACE_B] } } })
    await prisma.user.deleteMany({ where: { id: { in: [ADMIN_A, ADMIN_B, MEMBER_A] } } })
    unregister()
    await prisma.$disconnect()
  })

  test('다른 space ADMIN이 승인 시도 → 403, execute 미실행 (IDOR 차단)', async () => {
    const { actionId } = await makeActionInSpace(SPACE_A, ADMIN_A)
    mockUserId = ADMIN_B // Space B의 ADMIN — Space A 액션엔 권한 없어야
    const res = await PATCH(patchReq('approve'), { params: Promise.resolve({ actionId }) })
    expect(res.status).toBe(403)
    expect(execCount).toBe(0)
    const row = await prisma.agentPendingAction.findUnique({ where: { id: actionId } })
    expect(row?.status).toBe('PENDING') // 변경 안 됨
  })

  test('같은 space MEMBER가 승인 시도 → 403 (역할 부족)', async () => {
    const { actionId } = await makeActionInSpace(SPACE_A, ADMIN_A)
    mockUserId = MEMBER_A
    const res = await PATCH(patchReq('approve'), { params: Promise.resolve({ actionId }) })
    expect(res.status).toBe(403)
    expect(execCount).toBe(0)
  })

  test('같은 space ADMIN이 승인 → 200 EXECUTED', async () => {
    const { actionId } = await makeActionInSpace(SPACE_A, ADMIN_A)
    mockUserId = ADMIN_A
    const res = await PATCH(patchReq('approve'), { params: Promise.resolve({ actionId }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.outcome.status).toBe('EXECUTED')
    expect(execCount).toBe(1)
  })

  test('비멤버가 단건 조회 → 403', async () => {
    const { actionId } = await makeActionInSpace(SPACE_A, ADMIN_A)
    mockUserId = ADMIN_B // Space A 비멤버
    const res = await getOne(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ actionId }),
    })
    expect(res.status).toBe(403)
  })

  test('이미 처리된 액션 재승인 → 409 CONFLICT', async () => {
    const { actionId } = await makeActionInSpace(SPACE_A, ADMIN_A)
    mockUserId = ADMIN_A
    await PATCH(patchReq('approve'), { params: Promise.resolve({ actionId }) })
    const res2 = await PATCH(patchReq('approve'), { params: Promise.resolve({ actionId }) })
    expect(res2.status).toBe(409)
  })
})
