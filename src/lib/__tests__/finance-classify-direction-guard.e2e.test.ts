/**
 * staging/[id] + staging/bulk — OUT 행에 INCOME 카테고리 차단 e2e (수정 7 검증).
 *
 * 검증 항목:
 *   1. 단건: OUT 방향 staged 행에 INCOME 계정과목 지정 시 400 반환.
 *   2. 단건: IN 방향 staged 행에 EXPENSE 계정과목 지정 시 허용(환불 케이스).
 *   3. 일괄: OUT 행 포함 선택에 INCOME 계정과목 지정 시 400 반환.
 *   4. 일괄: IN 행만 선택 시 INCOME 계정과목 허용.
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
const USER_ID  = 'e2e0fin0-0000-4000-8000-0000000000d2'
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

d('finance classify direction guard (dev DB)', () => {
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

  test('단건: OUT 행에 INCOME 계정 → 400', async () => {
    const { PATCH } = await import('@/app/api/finance/staging/[id]/route')
    const req = new Request(`http://localhost/api/finance/staging/${outRowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: incomeCatId, learn: false }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req as never, { params: Promise.resolve({ id: outRowId }) })
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toMatch(/수입 계정과목/)
  })

  test('단건: IN 행에 EXPENSE 계정 → 허용(200)', async () => {
    const { PATCH } = await import('@/app/api/finance/staging/[id]/route')
    const req = new Request(`http://localhost/api/finance/staging/${inRowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: expenseCatId, learn: false }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req as never, { params: Promise.resolve({ id: inRowId }) })
    expect(res!.status).toBe(200)
  })

  // ── 일괄 POST ──

  test('일괄: OUT 행 포함 선택에 INCOME 계정 → 400', async () => {
    const { POST } = await import('@/app/api/finance/staging/bulk/route')
    const req = new Request('http://localhost/api/finance/staging/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: [outRowId, inRowId], categoryId: incomeCatId }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req as never)
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toMatch(/수입 계정과목/)
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
})
