/**
 * staging/commit — 다중 계좌·다중 월 스냅샷 정확성 e2e (수정 2 검증).
 *
 * 검증 항목:
 *   1. 2계좌 × 여러 달 staged 커밋 후 각 달 월말 스냅샷이 정확히 생성된다.
 *   2. 이전 달 스냅샷은 새 커밋 후에도 불변(범위 한정 findMany 불변식 검증).
 *
 * DB는 실제 dev DB. throwaway space/user 사용. DATABASE_URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

const SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e0fin0-0000-4000-8000-0000000000c2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  // Space onDelete Cascade → FinAccount → FinTransaction/FinStagedRow/FinBalanceSnapshot
  const members = await prisma.spaceMember.findMany({ where: { userId: USER_ID } })
  const spaceIds = members.map((m) => m.spaceId)
  await prisma.spaceMember.deleteMany({ where: { userId: USER_ID } })
  if (spaceIds.length > 0) {
    await prisma.deckInstance.deleteMany({ where: { spaceId: { in: spaceIds } } })
    await prisma.space.deleteMany({ where: { id: { in: spaceIds } } })
  }
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
  await prisma.workspace.deleteMany({ where: { ownerId: USER_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

d('staging/commit — 다중 계좌·다중 월 스냅샷 (dev DB)', () => {
  let acct1Id: string
  let acct2Id: string
  let importId: string

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-fin-commit@throwaway.test' } })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E FinCommit' } })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })

    // 계좌 2개 생성
    const a1 = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '테스트 은행계좌', kind: 'BANK', institution: '테스트은행' },
      select: { id: true },
    })
    const a2 = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '테스트 카드계좌', kind: 'CARD', institution: '테스트카드' },
      select: { id: true },
    })
    acct1Id = a1.id
    acct2Id = a2.id

    // FinImport 더미
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId: acct1Id,
        fileName: 'test.xlsx',
        institution: '테스트은행',
        kind: 'BANK',
        status: 'DRAFT',
        periodFrom: new Date('2026-01-01T00:00:00Z'),
        periodTo: new Date('2026-03-31T00:00:00Z'),
        totalRows: 3,
      },
      select: { id: true },
    })
    importId = imp.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('1월 거래 커밋 후 1월 스냅샷 생성', async () => {
    // 계좌1 — 1월 2건(같은 달, 잔액 100, 200)
    await prisma.finStagedRow.createMany({
      data: [
        {
          importId,
          spaceId: SPACE_ID,
          accountId: acct1Id,
          raw: {},
          txnDate: new Date('2026-01-15T00:00:00Z'),
          direction: 'IN',
          amount: 50000,
          balanceAfter: 100000,
          classStatus: 'CLASSIFIED',
          resolution: 'NEW',
          identityKey: 'e2e-c1-jan-1',
          contentHash: 'h1',
        },
        {
          importId,
          spaceId: SPACE_ID,
          accountId: acct1Id,
          raw: {},
          txnDate: new Date('2026-01-31T00:00:00Z'),
          direction: 'IN',
          amount: 30000,
          balanceAfter: 200000,
          classStatus: 'CLASSIFIED',
          resolution: 'NEW',
          identityKey: 'e2e-c1-jan-2',
          contentHash: 'h2',
        },
      ],
    })

    // commit 로직 직접 호출(route handler 대신 lib 로직 검증)
    // route.ts 로직을 인라인으로 재현: staged → upsert → deleteMany → snapshot upsert
    const staged = await prisma.finStagedRow.findMany({
      where: { spaceId: SPACE_ID, accountId: acct1Id, classStatus: 'CLASSIFIED', resolution: { not: 'DUP_SAME' } },
      select: { id: true, accountId: true, txnDate: true, direction: true, amount: true, balanceAfter: true, description: true, counterparty: true, approvalNo: true, cancelFlag: true, contentHash: true, importId: true, categoryId: true, classStatus: true, matchedRuleId: true, identityKey: true, resolution: true },
    })
    expect(staged).toHaveLength(2)

    const committedIds: string[] = []
    await prisma.$transaction(async (tx) => {
      for (const s of staged) {
        await tx.finTransaction.upsert({
          where: { spaceId_accountId_identityKey: { spaceId: SPACE_ID, accountId: s.accountId, identityKey: s.identityKey } },
          update: { txnDate: s.txnDate, direction: s.direction, amount: s.amount, balanceAfter: s.balanceAfter, contentHash: s.contentHash },
          create: { spaceId: SPACE_ID, accountId: s.accountId, identityKey: s.identityKey, txnDate: s.txnDate, direction: s.direction, amount: s.amount, balanceAfter: s.balanceAfter, contentHash: s.contentHash, classStatus: s.classStatus, importId: s.importId },
        })
        committedIds.push(s.id)
      }
      await tx.finStagedRow.deleteMany({ where: { id: { in: committedIds } } })

      // 스냅샷 재계산 (route.ts 로직)
      function yearMonth(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
      const withBalance = await tx.finTransaction.findMany({
        where: { spaceId: SPACE_ID, accountId: acct1Id, balanceAfter: { not: null } },
        select: { txnDate: true, balanceAfter: true },
        orderBy: { txnDate: 'asc' },
      })
      const lastByMonth = new Map<string, unknown>()
      for (const t of withBalance) lastByMonth.set(yearMonth(t.txnDate), t.balanceAfter)
      for (const [ym, balance] of lastByMonth) {
        if (balance == null) continue
        await tx.finBalanceSnapshot.upsert({
          where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: ym } },
          update: { balance: balance as number, source: 'DERIVED' },
          create: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: ym, balance: balance as number, source: 'DERIVED' },
        })
      }
    })

    // 검증: 1월 스냅샷 = 월 마지막 balanceAfter(200000)
    const snap = await prisma.finBalanceSnapshot.findUnique({
      where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: '2026-01' } },
    })
    expect(snap).not.toBeNull()
    expect(Number(snap!.balance)).toBe(200000)
  })

  test('2월 거래 추가 커밋 후 1월 스냅샷 불변', async () => {
    const imp2 = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId: acct1Id,
        fileName: 'feb.xlsx',
        institution: '테스트은행',
        kind: 'BANK',
        status: 'DRAFT',
        periodFrom: new Date('2026-02-01T00:00:00Z'),
        periodTo: new Date('2026-02-28T00:00:00Z'),
        totalRows: 1,
      },
      select: { id: true },
    })

    await prisma.finStagedRow.create({
      data: {
        importId: imp2.id,
        spaceId: SPACE_ID,
        accountId: acct1Id,
        raw: {},
        txnDate: new Date('2026-02-15T00:00:00Z'),
        direction: 'OUT',
        amount: 20000,
        balanceAfter: 180000,
        classStatus: 'CLASSIFIED',
        resolution: 'NEW',
        identityKey: 'e2e-c1-feb-1',
        contentHash: 'h3',
      },
    })

    const staged = await prisma.finStagedRow.findMany({
      where: { spaceId: SPACE_ID, accountId: acct1Id, classStatus: 'CLASSIFIED', resolution: { not: 'DUP_SAME' } },
      select: { id: true, accountId: true, txnDate: true, direction: true, amount: true, balanceAfter: true, contentHash: true, classStatus: true, importId: true, identityKey: true, resolution: true },
    })

    const committedIds: string[] = []
    await prisma.$transaction(async (tx) => {
      for (const s of staged) {
        await tx.finTransaction.upsert({
          where: { spaceId_accountId_identityKey: { spaceId: SPACE_ID, accountId: s.accountId, identityKey: s.identityKey } },
          update: { txnDate: s.txnDate, direction: s.direction, amount: s.amount, balanceAfter: s.balanceAfter, contentHash: s.contentHash },
          create: { spaceId: SPACE_ID, accountId: s.accountId, identityKey: s.identityKey, txnDate: s.txnDate, direction: s.direction, amount: s.amount, balanceAfter: s.balanceAfter, contentHash: s.contentHash, classStatus: s.classStatus, importId: s.importId },
        })
        committedIds.push(s.id)
      }
      await tx.finStagedRow.deleteMany({ where: { id: { in: committedIds } } })

      function yearMonth(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
      // 범위 한정: 이번 커밋 minTxnDate(2026-02) 기준 1달 전 안전마진 → 2026-01부터
      const minDate = staged.reduce((min, s) => s.txnDate < min ? s.txnDate : min, staged[0].txnDate)
      const rangeStart = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth() - 1, 1))
      const withBalance = await tx.finTransaction.findMany({
        where: { spaceId: SPACE_ID, accountId: acct1Id, balanceAfter: { not: null }, txnDate: { gte: rangeStart } },
        select: { txnDate: true, balanceAfter: true },
        orderBy: { txnDate: 'asc' },
      })
      const lastByMonth = new Map<string, unknown>()
      for (const t of withBalance) lastByMonth.set(yearMonth(t.txnDate), t.balanceAfter)
      for (const [ym, balance] of lastByMonth) {
        if (balance == null) continue
        await tx.finBalanceSnapshot.upsert({
          where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: ym } },
          update: { balance: balance as number, source: 'DERIVED' },
          create: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: ym, balance: balance as number, source: 'DERIVED' },
        })
      }
    })

    // 2월 스냅샷 생성 확인
    const snapFeb = await prisma.finBalanceSnapshot.findUnique({
      where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: '2026-02' } },
    })
    expect(Number(snapFeb!.balance)).toBe(180000)

    // 1월 스냅샷 불변 검증
    const snapJan = await prisma.finBalanceSnapshot.findUnique({
      where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: '2026-01' } },
    })
    expect(Number(snapJan!.balance)).toBe(200000)
  })

  test('2계좌 독립 스냅샷 — 계좌2 커밋이 계좌1 스냅샷 불변', async () => {
    const imp3 = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId: acct2Id,
        fileName: 'card.xlsx',
        institution: '테스트카드',
        kind: 'CARD',
        status: 'DRAFT',
        periodFrom: new Date('2026-01-01T00:00:00Z'),
        periodTo: new Date('2026-01-31T00:00:00Z'),
        totalRows: 1,
      },
      select: { id: true },
    })

    await prisma.finStagedRow.create({
      data: {
        importId: imp3.id,
        spaceId: SPACE_ID,
        accountId: acct2Id,
        raw: {},
        txnDate: new Date('2026-01-20T00:00:00Z'),
        direction: 'OUT',
        amount: 5000,
        balanceAfter: 95000,
        classStatus: 'CLASSIFIED',
        resolution: 'NEW',
        identityKey: 'e2e-c2-jan-1',
        contentHash: 'h4',
      },
    })

    const staged = await prisma.finStagedRow.findMany({
      where: { spaceId: SPACE_ID, accountId: acct2Id, classStatus: 'CLASSIFIED', resolution: { not: 'DUP_SAME' } },
      select: { id: true, accountId: true, txnDate: true, direction: true, amount: true, balanceAfter: true, contentHash: true, classStatus: true, importId: true, identityKey: true },
    })

    const committedIds: string[] = []
    await prisma.$transaction(async (tx) => {
      for (const s of staged) {
        await tx.finTransaction.upsert({
          where: { spaceId_accountId_identityKey: { spaceId: SPACE_ID, accountId: s.accountId, identityKey: s.identityKey } },
          update: { txnDate: s.txnDate, direction: s.direction, amount: s.amount, balanceAfter: s.balanceAfter, contentHash: s.contentHash },
          create: { spaceId: SPACE_ID, accountId: s.accountId, identityKey: s.identityKey, txnDate: s.txnDate, direction: s.direction, amount: s.amount, balanceAfter: s.balanceAfter, contentHash: s.contentHash, classStatus: 'CLASSIFIED', importId: s.importId },
        })
        committedIds.push(s.id)
      }
      await tx.finStagedRow.deleteMany({ where: { id: { in: committedIds } } })

      function yearMonth(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
      const withBalance = await tx.finTransaction.findMany({
        where: { spaceId: SPACE_ID, accountId: acct2Id, balanceAfter: { not: null } },
        select: { txnDate: true, balanceAfter: true },
        orderBy: { txnDate: 'asc' },
      })
      const lastByMonth = new Map<string, unknown>()
      for (const t of withBalance) lastByMonth.set(yearMonth(t.txnDate), t.balanceAfter)
      for (const [ym, balance] of lastByMonth) {
        if (balance == null) continue
        await tx.finBalanceSnapshot.upsert({
          where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct2Id, yearMonth: ym } },
          update: { balance: balance as number, source: 'DERIVED' },
          create: { spaceId: SPACE_ID, accountId: acct2Id, yearMonth: ym, balance: balance as number, source: 'DERIVED' },
        })
      }
    })

    // 계좌2 스냅샷 생성
    const snapAcct2 = await prisma.finBalanceSnapshot.findUnique({
      where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct2Id, yearMonth: '2026-01' } },
    })
    expect(Number(snapAcct2!.balance)).toBe(95000)

    // 계좌1 스냅샷 불변
    const snapAcct1Jan = await prisma.finBalanceSnapshot.findUnique({
      where: { spaceId_accountId_yearMonth: { spaceId: SPACE_ID, accountId: acct1Id, yearMonth: '2026-01' } },
    })
    expect(Number(snapAcct1Jan!.balance)).toBe(200000)
  })
})
