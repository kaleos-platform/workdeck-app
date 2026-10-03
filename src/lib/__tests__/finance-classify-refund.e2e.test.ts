/**
 * staging/[id] + staging/bulk — 환불(계정 섹션과 반대 방향) 분류 e2e.
 * 방향 가드(PR #331)는 #993에서 제거됐다 — 환불은 원래 계정에 분류하고 그 섹션에서 차감한다(contra.ts).
 * 대신 환불 분류는 규칙으로 학습하지 않는다(classify.ts learnRule).
 *
 * 검증 항목:
 *   1. 단건: OUT 행에 INCOME 계정(고객 환불) → 200, learn=true여도 규칙 미생성.
 *   2. 단건: IN 행에 EXPENSE 계정(비용 환급) → 200, 규칙 미생성.
 *   3. 일괄: 방향이 섞인 선택에 INCOME 계정 → 200.
 *   4. 일괄: IN 행만 선택 시 INCOME 계정 → 200.
 *   5. 단건: 정상 방향(IN 행에 INCOME 계정) + learn=true → 규칙 생성.
 *
 * route handler를 직접 import해 테스트한다. DB는 실제 dev DB.
 * DATABASE_URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'

// resolveDeckContext를 mock — space/user 인증 우회
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}))

import { resolveDeckContext } from '@/lib/api-helpers'

const SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000d1'
const USER_ID = 'e2e0fin0-0000-4000-8000-0000000000d2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
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

d('finance classify refund (dev DB)', () => {
  let accountId: string
  let importId: string
  let incomeCatId: string
  let expenseCatId: string
  let outRowId: string
  let inRowId: string

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-fin-guard@throwaway.test' } })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E FinGuard' } })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })

    const acct = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '가드테스트계좌', kind: 'BANK', institution: '테스트은행' },
      select: { id: true },
    })
    accountId = acct.id

    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'guard.xlsx',
        institution: '테스트은행',
        kind: 'BANK',
        status: 'DRAFT',
        periodFrom: new Date('2026-01-01'),
        periodTo: new Date('2026-01-31'),
        totalRows: 2,
      },
      select: { id: true },
    })
    importId = imp.id

    // INCOME 계정과목
    const incCat = await prisma.finCategory.create({
      data: { spaceId: SPACE_ID, name: '테스트수입계정', type: 'INCOME' },
      select: { id: true },
    })
    incomeCatId = incCat.id

    // EXPENSE 계정과목
    const expCat = await prisma.finCategory.create({
      data: { spaceId: SPACE_ID, name: '테스트지출계정', type: 'EXPENSE' },
      select: { id: true },
    })
    expenseCatId = expCat.id

    // OUT 방향 staged 행
    const outRow = await prisma.finStagedRow.create({
      data: {
        importId,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-01-10'),
        direction: 'OUT',
        amount: 10000,
        classStatus: 'UNCLASSIFIED',
        resolution: 'NEW',
        description: '고객 환불 홍길동',
        identityKey: 'e2e-guard-out-1',
        contentHash: 'gh1',
      },
      select: { id: true },
    })
    outRowId = outRow.id

    // IN 방향 staged 행
    const inRow = await prisma.finStagedRow.create({
      data: {
        importId,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-01-15'),
        direction: 'IN',
        amount: 5000,
        classStatus: 'UNCLASSIFIED',
        resolution: 'NEW',
        description: '광고비 환급',
        identityKey: 'e2e-guard-in-1',
        contentHash: 'gh2',
      },
      select: { id: true },
    })
    inRowId = inRow.id

    // mock resolveDeckContext
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: SPACE_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  // ── 단건 PATCH ──

  test('단건: OUT 행에 INCOME 계정(고객 환불) → 200, 규칙 미생성', async () => {
    const { PATCH } = await import('@/app/api/finance/staging/[id]/route')
    const req = new Request(`http://localhost/api/finance/staging/${outRowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: incomeCatId, learn: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req as never, { params: Promise.resolve({ id: outRowId }) })
    expect(res!.status).toBe(200)
    expect(await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })).toBe(0)
  })

  test('단건: IN 행에 EXPENSE 계정(비용 환급) → 200, 규칙 미생성', async () => {
    const { PATCH } = await import('@/app/api/finance/staging/[id]/route')
    const req = new Request(`http://localhost/api/finance/staging/${inRowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: expenseCatId, learn: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req as never, { params: Promise.resolve({ id: inRowId }) })
    expect(res!.status).toBe(200)
    expect(await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })).toBe(0)
  })

  // ── 일괄 POST ──

  test('일괄: 방향이 섞인 선택에 INCOME 계정 → 200', async () => {
    const { POST } = await import('@/app/api/finance/staging/bulk/route')
    const req = new Request('http://localhost/api/finance/staging/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [outRowId, inRowId], categoryId: incomeCatId }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as never)
    expect(res!.status).toBe(200)
  })

  test('일괄: IN 행만 선택 시 INCOME 계정 → 허용(200)', async () => {
    // IN 행을 새로 만들어 분류 미완 상태로 테스트
    const inRow2 = await prisma.finStagedRow.create({
      data: {
        importId,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-01-20'),
        direction: 'IN',
        amount: 3000,
        classStatus: 'UNCLASSIFIED',
        resolution: 'NEW',
        identityKey: 'e2e-guard-in-2',
        contentHash: 'gh3',
      },
      select: { id: true },
    })

    const { POST } = await import('@/app/api/finance/staging/bulk/route')
    const req = new Request('http://localhost/api/finance/staging/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [inRow2.id], categoryId: incomeCatId }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as never)
    expect(res!.status).toBe(200)
  })

  test('단건: 정상 방향(IN 행에 INCOME 계정) + learn → 규칙 생성', async () => {
    const inRow3 = await prisma.finStagedRow.create({
      data: {
        importId,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-01-25'),
        direction: 'IN',
        amount: 7000,
        description: '쿠팡 정산입금',
        classStatus: 'UNCLASSIFIED',
        resolution: 'NEW',
        identityKey: 'e2e-guard-in-3',
        contentHash: 'gh4',
      },
      select: { id: true },
    })
    const { PATCH } = await import('@/app/api/finance/staging/[id]/route')
    const req = new Request(`http://localhost/api/finance/staging/${inRow3.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: incomeCatId, learn: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req as never, { params: Promise.resolve({ id: inRow3.id }) })
    expect(res!.status).toBe(200)
    const rules = await prisma.finClassRule.findMany({ where: { spaceId: SPACE_ID } })
    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({ categoryId: incomeCatId, direction: 'IN' })
  })
})
