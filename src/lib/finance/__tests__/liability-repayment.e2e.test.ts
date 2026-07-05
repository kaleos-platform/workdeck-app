/** @jest-environment node */
/**
 * 부채 상환 연결 → 감지 → 원클릭 반영 왕복 E2E (dev DB + 실제 라우트 핸들러).
 * getUser만 mock. 전용 throwaway space/user로 실데이터 격리. afterAll 0-state 복원.
 *
 * 검증: (1) 거래를 부채에 연결(PATCH liabilityId, bulk), (2) 대시보드 pending 감지,
 *       (3) 잔액 반영(PATCH balance+balanceAsOf) 후 재감지 안 됨(워터마크 중복방지).
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

// routes.e2e.test.ts 와 다른 space/user — 병렬 실행 충돌 방지.
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000a1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000a2'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)

let mockUserId = ''
jest.mock('@/hooks/use-user', () => ({
  getUser: async () => (mockUserId ? { id: mockUserId } : null),
}))

import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { PATCH as liabilityPatch } from '../../../../app/api/finance/liabilities/[id]/route'
import { POST as liabilitiesPost } from '../../../../app/api/finance/liabilities/route'
import { PATCH as txnPatch } from '../../../../app/api/finance/transactions/[id]/route'
import { POST as txnBulk } from '../../../../app/api/finance/transactions/bulk/route'
import { GET as dashboardGet } from '../../../../app/api/finance/dashboard/route'

const d = RUN ? describe : describe.skip

async function call<T>(p: Promise<T | undefined>): Promise<T> {
  const r = await p
  if (r == null) throw new Error('route handler returned undefined')
  return r
}

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type DashLiability = {
  id: string
  balance: number
  accountId: string | null
  pending: { count: number; sum: number; throughDate: string | null }
}
async function fetchLiability(id: string): Promise<DashLiability> {
  const res = await call(dashboardGet(new NextRequest('http://localhost/api/finance/dashboard')))
  const json = (await res.json()) as { liabilities: DashLiability[] }
  const found = json.liabilities.find((l) => l.id === id)
  if (!found) throw new Error('liability not in dashboard')
  return found
}

async function makeTxn(accountId: string, amount: number, txnDate: Date, key: string) {
  return prisma.finTransaction.create({
    data: {
      spaceId: SPACE_ID,
      accountId,
      txnDate,
      direction: 'OUT',
      amount,
      identityKey: key,
      contentHash: key,
    },
    select: { id: true },
  })
}

async function cleanup() {
  await prisma.finTransaction.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finLiability.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finAccount.deleteMany({ where: { spaceId: SPACE_ID } })
}

d('부채 상환 연결→감지→반영 E2E', () => {
  let accountId = ''
  let liabilityId = ''
  let txn1 = ''
  let txn2 = ''

  beforeAll(async () => {
    mockUserId = USER_ID
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-liability@throwaway.test', name: 'E2E Liability' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Liability Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'finance' } },
      update: { isActive: true },
      create: { spaceId: SPACE_ID, deckAppId: 'finance', isActive: true },
    })
    await cleanup()
    const acct = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '우리은행 테스트', kind: 'BANK', institution: '우리은행' },
      select: { id: true },
    })
    accountId = acct.id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID, deckAppId: 'finance' } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    mockUserId = ''
  })

  test('부채 생성 + 계좌 연결', async () => {
    const res = await call(
      liabilitiesPost(
        jsonReq('/api/finance/liabilities', 'POST', {
          name: '청년대출',
          principal: 10_000_000,
          balance: 8_000_000,
          monthlyPayment: 500_000,
          accountId,
        })
      )
    )
    expect(res.status).toBe(201)
    const { liability } = (await res.json()) as { liability: { id: string; accountId: string | null } }
    expect(liability.accountId).toBe(accountId)
    liabilityId = liability.id

    // 워터마크를 과거로 고정 — 이후 2026-06 상환이 결정적으로 감지되도록.
    await call(
      liabilityPatch(
        jsonReq(`/api/finance/liabilities/${liabilityId}`, 'PATCH', {
          balanceAsOf: '2020-01-01T00:00:00.000Z',
        }),
        { params: Promise.resolve({ id: liabilityId }) }
      )
    )
  })

  test('상환 거래 연결 — 단건 PATCH + 벌크', async () => {
    const t1 = await makeTxn(accountId, 500_000, new Date('2026-06-10'), 'liab-t1')
    const t2 = await makeTxn(accountId, 500_000, new Date('2026-07-10'), 'liab-t2')
    txn1 = t1.id
    txn2 = t2.id

    // 단건 연결
    const r1 = await call(
      txnPatch(jsonReq(`/api/finance/transactions/${txn1}`, 'PATCH', { liabilityId }), {
        params: Promise.resolve({ id: txn1 }),
      })
    )
    expect(r1.status).toBe(200)
    const j1 = (await r1.json()) as { transaction: { liabilityId: string | null } }
    expect(j1.transaction.liabilityId).toBe(liabilityId)

    // 벌크 연결
    const r2 = await call(
      txnBulk(jsonReq('/api/finance/transactions/bulk', 'POST', { ids: [txn2], liabilityId }))
    )
    const j2 = (await r2.json()) as { updated: number }
    expect(j2.updated).toBe(1)
  })

  test('대시보드 pending 감지 — 워터마크 이후 연결 상환 2건', async () => {
    const l = await fetchLiability(liabilityId)
    expect(l.pending.count).toBe(2)
    expect(l.pending.sum).toBe(1_000_000)
    expect(l.pending.throughDate).toBe(new Date('2026-07-10').toISOString())
    expect(l.accountId).toBe(accountId)
  })

  test('원클릭 반영 — balance 감소 + 워터마크 전진 → 재감지 없음', async () => {
    const before = await fetchLiability(liabilityId)
    const newBalance = before.balance - before.pending.sum // 8,000,000 - 1,000,000
    const res = await call(
      liabilityPatch(
        jsonReq(`/api/finance/liabilities/${liabilityId}`, 'PATCH', {
          balance: newBalance,
          balanceAsOf: before.pending.throughDate,
        }),
        { params: Promise.resolve({ id: liabilityId }) }
      )
    )
    expect(res.status).toBe(200)

    const after = await fetchLiability(liabilityId)
    expect(after.balance).toBe(7_000_000)
    expect(after.pending.count).toBe(0) // 워터마크가 마지막 상환일로 전진 → 중복 반영 방지
    expect(after.pending.sum).toBe(0)
  })

  test('연결 해제 — 벌크 liabilityId null', async () => {
    const res = await call(
      txnBulk(
        jsonReq('/api/finance/transactions/bulk', 'POST', { ids: [txn1, txn2], liabilityId: null })
      )
    )
    const j = (await res.json()) as { updated: number }
    expect(j.updated).toBe(2)
    const rows = await prisma.finTransaction.findMany({
      where: { spaceId: SPACE_ID },
      select: { liabilityId: true },
    })
    expect(rows.every((r) => r.liabilityId === null)).toBe(true)
  })
})
