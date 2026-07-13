/**
 * Phase 4 finance 액션 실행 e2e — 실 dev DB.
 * create → approveAndExecute 전 경로로 실제 DB 변경이 일어나는지 검증한다
 * (서브에이전트가 추출한 execute 로직의 회귀 확인 — DB 테스트는 메인 세션 전용).
 */
import { prisma } from '@/lib/prisma'
import { createPendingAction } from '../create'
import { approveAndExecute } from '../execute'

const RUN = Boolean(process.env.DATABASE_URL)
const d = RUN ? describe : describe.skip

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000b1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000b2'
const ACCT_ID = 'e2e00000-0000-4000-8000-0000000000b3'

d('finance 액션 실행', () => {
  let categoryId: string
  let txnId: string

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-finact@throwaway.test', name: 'E2E FinAct' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E FinAct Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    await prisma.finAccount.upsert({
      where: { id: ACCT_ID },
      update: {},
      create: {
        id: ACCT_ID,
        spaceId: SPACE_ID,
        name: 'E2E 계좌',
        kind: 'BANK',
        institution: '테스트은행',
      },
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
        amount: 12000,
        classStatus: 'UNCLASSIFIED',
        description: '스타벅스',
        counterparty: '스타벅스코리아',
        identityKey: `e2e-${Date.now()}-${Math.random()}`,
        contentHash: 'e2ehash',
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
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  })

  test('reclassify: 승인 실행 → 거래 CLASSIFIED + categoryId 반영', async () => {
    const created = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'finance.transaction.reclassify',
      params: { transactionId: txnId, categoryId, learn: false },
      summary: '스타벅스 → 식비',
      source: 'MCP',
      requestedBy: USER_ID,
    })
    const out = await approveAndExecute(created.actionId, USER_ID)
    expect(out.status).toBe('EXECUTED')
    const txn = await prisma.finTransaction.findUnique({ where: { id: txnId } })
    expect(txn?.categoryId).toBe(categoryId)
    expect(txn?.classStatus).toBe('CLASSIFIED')
  })

  test('reclassify: beforeState 스냅샷이 실행 전 상태를 캡처', async () => {
    const created = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'finance.transaction.reclassify',
      params: { transactionId: txnId, categoryId, learn: false },
      summary: 's',
      source: 'MCP',
      requestedBy: USER_ID,
    })
    const row = await prisma.agentPendingAction.findUnique({ where: { id: created.actionId } })
    // 실행 전 = UNCLASSIFIED, categoryId null
    expect((row?.beforeState as { classStatus?: string } | null)?.classStatus).toBe('UNCLASSIFIED')
  })

  test('classrule.create: 승인 실행 → 규칙 생성', async () => {
    const created = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'finance.classrule.create',
      params: { matchKey: '스타벅스', categoryId, matchType: 'KEYWORD' },
      summary: '규칙: 스타벅스 → 식비',
      source: 'MCP',
      requestedBy: USER_ID,
    })
    const out = await approveAndExecute(created.actionId, USER_ID)
    expect(out.status).toBe('EXECUTED')
    const rules = await prisma.finClassRule.findMany({ where: { spaceId: SPACE_ID, categoryId } })
    expect(rules.length).toBe(1)
    expect(rules[0].matchType).toBe('KEYWORD')
    expect(rules[0].learnedFrom).toBe('USER')
  })

  test('reclassify: 존재하지 않는 거래 → FAILED', async () => {
    const created = await createPendingAction({
      spaceId: SPACE_ID,
      actionType: 'finance.transaction.reclassify',
      params: { transactionId: 'nonexistent', categoryId, learn: false },
      summary: 's',
      source: 'MCP',
      requestedBy: USER_ID,
    })
    const out = await approveAndExecute(created.actionId, USER_ID)
    expect(out.status).toBe('FAILED')
    const row = await prisma.agentPendingAction.findUnique({ where: { id: created.actionId } })
    expect(row?.status).toBe('FAILED')
    expect(row?.error).toContain('거래')
  })
})
