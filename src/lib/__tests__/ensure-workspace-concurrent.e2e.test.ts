/**
 * ensureWorkspaceForUser 동시 호출 직렬화 e2e.
 *
 * 동일 user.id로 Promise.all([ensureWorkspaceForUser, ensureWorkspaceForUser]) 시
 * 둘 다 성공(예외 없음), Workspace 정확 1개, Space 정확 1개, SpaceMember 정확 1개.
 * advisory lock 없으면 ownerId unique P2002로 한쪽 500 또는 Space 중복 생성 → red.
 *
 * throwaway user/workspace를 시드. afterAll cascade로 0-state 복원. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { ensureWorkspaceForUser } from '@/lib/workspace'

// throwaway — 다른 e2e와 충돌 없도록 고유 hex UUID 사용
const USER_ID = 'e2e00000-0000-4000-8000-00000000ef01'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)

describe('ensureWorkspaceForUser — 동시 호출 직렬화', () => {
  beforeAll(async () => {
    if (!RUN) return
    // 잔여 레코드 정리 (이전 실패 시 복원)
    await cleanupThrowaway()
  })

  afterAll(async () => {
    if (!RUN) return
    await cleanupThrowaway()
    await prisma.$disconnect()
  })

  it('두 동시 호출이 모두 성공하고 Workspace/Space/SpaceMember가 각 1개', async () => {
    if (!RUN) {
      console.warn('DATABASE_URL 미설정 — e2e 건너뜀')
      return
    }

    const user = { id: USER_ID, email: 'e2e-concurrent@example.com', name: 'E2E Concurrent' }

    // 동시 호출
    const [r1, r2] = await Promise.all([
      ensureWorkspaceForUser(user, '동시테스트 워크스페이스'),
      ensureWorkspaceForUser(user, '동시테스트 워크스페이스'),
    ])

    // 둘 다 값 반환(예외 없음)
    expect(r1).toBeDefined()
    expect(r2).toBeDefined()

    // Workspace 정확 1개
    const workspaces = await prisma.workspace.findMany({ where: { ownerId: USER_ID } })
    expect(workspaces).toHaveLength(1)

    // SpaceMember 정확 1개
    const members = await prisma.spaceMember.findMany({ where: { userId: USER_ID } })
    expect(members).toHaveLength(1)

    // Space 정확 1개 (spaceId로 역추적)
    const spaceId = members[0].spaceId
    const spaces = await prisma.space.findMany({ where: { id: spaceId } })
    expect(spaces).toHaveLength(1)
  })
})

async function cleanupThrowaway() {
  // FK 순서: SpaceMember → DeckInstance → Space → Workspace → User
  const members = await prisma.spaceMember.findMany({ where: { userId: USER_ID } })
  const spaceIds = members.map((m) => m.spaceId)

  await prisma.spaceMember.deleteMany({ where: { userId: USER_ID } })
  if (spaceIds.length > 0) {
    await prisma.deckInstance.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.space.deleteMany({ where: { id: { in: spaceIds } } })
  }
  await prisma.workspace.deleteMany({ where: { ownerId: USER_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}
