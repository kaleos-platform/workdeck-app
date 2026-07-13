/**
 * MCP write tool 계약 e2e — 실 dev DB.
 * 계약: mode:"write" tool은 절대 직접 mutate하지 않고 승인 큐(PENDING)만 만든다.
 * 검증 핵심: (a) pending_approval 반환, (b) PENDING 액션 1건 생성,
 *   (c) 대상 도메인 행은 승인 전까지 변경되지 않음(거래 UNCLASSIFIED 유지·규칙 미생성).
 * 승인 후 실제 변경은 Phase 4 e2e(finance-actions)가 이미 검증했다.
 */
import { prisma } from '@/lib/prisma'
import { writeTools } from '../write-tools'
import { toolDefinitions } from '../index'
import { approveAndExecute } from '@/lib/agent/actions/execute'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000d2'
const ACCT_ID = 'e2e00000-0000-4000-8000-0000000000d3'

const byName = (n: string) => {
  const t = writeTools.find((x) => x.name === n)
  if (!t) throw new Error(`tool 없음: ${n}`)
  return t
}

d('write tool 계약 (승인 큐 경유·직접 mutate 금지)', () => {
  let categoryId: string
  let txnId: string

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-write@throwaway.test', name: 'E2E Write' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Write Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'ADMIN' },
    })
    // finance deck 활성 — resolveMcpDeckContext 게이트 통과용.
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'finance' } },
      update: { isActive: true },
      create: { spaceId: SPACE_ID, deckAppId: 'finance', isActive: true },
    })
    await prisma.finAccount.upsert({
      where: { id: ACCT_ID },
      update: {},
      create: { id: ACCT_ID, spaceId: SPACE_ID, name: 'E2E', kind: 'BANK', institution: '테스트' },
    })
  })

  beforeEach(async () => {
    const cat = await prisma.finCategory.create({
      data: { spaceId: SPACE_ID, name: '식비', type: 'EXPENSE' },
    })
    categoryId = cat.id
    const txn = await prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId: ACCT_ID,
        txnDate: new Date('2026-06-01T00:00:00'),
        direction: 'OUT',
        amount: 5000,
        classStatus: 'UNCLASSIFIED',
        description: '테스트가맹점',
        identityKey: `e2e-w-${Date.now()}-${Math.random()}`,
        contentHash: 'h',
      },
    })
    txnId = txn.id
  })

  afterEach(async () => {
    await prisma.agentPendingAction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.finTransaction.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.finClassRule.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.finCategory.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  afterAll(async () => {
    await prisma.finAccount.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('모든 write tool은 mode:"write"이고 레지스트리에 등록됨', () => {
    expect(writeTools.every((t) => t.mode === 'write')).toBe(true)
    for (const t of writeTools) {
      expect(toolDefinitions.some((x) => x.name === t.name)).toBe(true)
    }
  })

  test('classify: pending_approval 반환 + PENDING 1건 + 거래 UNCLASSIFIED 유지(직접 mutate 안 함)', async () => {
    const result = (await byName('finance_classify_transactions').execute(
      { userId: USER_ID },
      { transactionId: txnId, categoryId, learn: false }
    )) as { status: string; actionId: string }

    // (a) 승인 대기 반환
    expect(result.status).toBe('pending_approval')
    // (b) PENDING 액션 1건
    const pend = await prisma.agentPendingAction.findMany({
      where: { spaceId: SPACE_ID, actionType: 'finance.transaction.reclassify', status: 'PENDING' },
    })
    expect(pend).toHaveLength(1)
    // (c) 대상 거래는 승인 전까지 그대로 — 직접 mutate 없음.
    const txn = await prisma.finTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.classStatus).toBe('UNCLASSIFIED')
    expect(txn?.categoryId).toBeNull()

    // 승인 후에야 실제 변경(Phase 4 경로 재확인).
    await approveAndExecute(result.actionId, USER_ID)
    const after = await prisma.finTransaction.findUnique({ where: { id: txnId } })
    expect(after?.classStatus).toBe('CLASSIFIED')
    expect(after?.categoryId).toBe(categoryId)
  })

  test('create_class_rule: PENDING 1건 + 규칙 미생성(승인 전)', async () => {
    const result = (await byName('finance_create_class_rule').execute(
      { userId: USER_ID },
      { matchKey: '테스트가맹점', categoryId, matchType: 'KEYWORD' }
    )) as { status: string; actionId: string }

    expect(result.status).toBe('pending_approval')
    // 규칙은 아직 없어야 — 직접 mutate 금지.
    const rulesBefore = await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })
    expect(rulesBefore).toBe(0)

    await approveAndExecute(result.actionId, USER_ID)
    const rulesAfter = await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })
    expect(rulesAfter).toBe(1)
  })

  test('멱등: 동일 파라미터 재호출 → 같은 actionId(중복 큐 없음)', async () => {
    const p = { transactionId: txnId, categoryId, learn: false }
    const a = (await byName('finance_classify_transactions').execute({ userId: USER_ID }, p)) as {
      actionId: string
    }
    const b = (await byName('finance_classify_transactions').execute({ userId: USER_ID }, p)) as {
      actionId: string
    }
    expect(b.actionId).toBe(a.actionId)
    const count = await prisma.agentPendingAction.count({
      where: { spaceId: SPACE_ID, actionType: 'finance.transaction.reclassify' },
    })
    expect(count).toBe(1)
  })

  test('비활성 deck → throw(큐 미생성)', async () => {
    await prisma.deckInstance.update({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'finance' } },
      data: { isActive: false },
    })
    await expect(
      byName('finance_classify_transactions').execute(
        { userId: USER_ID },
        { transactionId: txnId, categoryId, learn: false }
      )
    ).rejects.toThrow()
    const count = await prisma.agentPendingAction.count({ where: { spaceId: SPACE_ID } })
    expect(count).toBe(0)
    // 복구
    await prisma.deckInstance.update({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'finance' } },
      data: { isActive: true },
    })
  })
})
