/** @jest-environment node */
/**
 * 커버리지·등록 이력 API E2E (dev DB + 실제 핸들러).
 * 샘플 파일 의존 없이 prisma로 직접 시드 — 전용 throwaway space/user 격리,
 * afterAll에서 0-state 복원.
 *
 * 핵심 단정: txnDate 저장 규약(KST 자릿수의 UTC 저장) — 월 집계가 timezone 변환 없이
 * 저장값 그대로(YYYY-MM) 이뤄지는지(월 경계 23:50 케이스 포함).
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)

let mockUserId = ''
jest.mock('@/hooks/use-user', () => ({
  getUser: async () => (mockUserId ? { id: mockUserId } : null),
}))

import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'

import { GET as coverageGet } from '../../../../app/api/finance/coverage/route'
import { GET as importsGet } from '../../../../app/api/finance/imports/route'

const d = RUN ? describe : describe.skip

async function call<T>(p: Promise<T | undefined>): Promise<T> {
  const r = await p
  if (r == null) throw new Error('route handler returned undefined')
  return r
}

function getRequest(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`)
}

async function cleanup() {
  await prisma.finTransaction.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finStagedRow.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finImport.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finAccount.deleteMany({ where: { spaceId: SPACE_ID } })
}

/** 이번 달 기준 offset개월 전의 YYYY-MM (coverage months 계산과 동일한 UTC 규약) */
function monthKey(offset: number): string {
  const now = new Date()
  const dte = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
  return `${dte.getUTCFullYear()}-${String(dte.getUTCMonth() + 1).padStart(2, '0')}`
}

/** offset개월 전 달의 특정 일시(UTC 저장 규약) Date */
function monthDate(offset: number, day: number, hh = 12, mm = 0): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, day, hh, mm, 0))
}

d('finance coverage/imports API E2E', () => {
  let bankId = ''
  let cardId = ''
  let draftImportId = ''
  let committedImportId = ''

  beforeAll(async () => {
    mockUserId = USER_ID
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-coverage@throwaway.test', name: 'E2E Coverage' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Coverage Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
    await prisma.deckApp.upsert({
      where: { id: 'finance' },
      update: { isActive: true },
      create: { id: 'finance', name: '재무 관리', isActive: true },
    })
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'finance' } },
      update: {},
      create: { spaceId: SPACE_ID, deckAppId: 'finance' },
    })
    await cleanup()

    const bank = await prisma.finAccount.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 은행',
        kind: 'BANK',
        institution: '기업은행',
        accountNumber: 'e2e-cov-111',
      },
    })
    bankId = bank.id
    const card = await prisma.finAccount.create({
      data: {
        spaceId: SPACE_ID,
        name: 'E2E 카드',
        kind: 'CARD',
        institution: '하나카드',
        accountNumber: 'e2e-cov-222',
      },
    })
    cardId = card.id

    // 커밋된 임포트(은행) — 지난달 확정 거래 2건, 그중 1건은 월말 경계(말일 23:50)
    const committed = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId: bankId,
        fileName: 'e2e-bank-lastmonth.csv',
        institution: '기업은행',
        kind: 'BANK',
        status: 'COMMITTED',
        totalRows: 2,
        committedRows: 2,
      },
    })
    committedImportId = committed.id
    // 지난달 말일 계산: 이번달 1일 UTC에서 -1일
    const now = new Date()
    const lastDayPrevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 24 * 60 * 60 * 1000
    )
    const boundaryDate = new Date(
      Date.UTC(
        lastDayPrevMonth.getUTCFullYear(),
        lastDayPrevMonth.getUTCMonth(),
        lastDayPrevMonth.getUTCDate(),
        23,
        50,
        0
      )
    )
    await prisma.finTransaction.createMany({
      data: [
        {
          spaceId: SPACE_ID,
          accountId: bankId,
          importId: committedImportId,
          txnDate: monthDate(1, 10),
          direction: 'OUT',
          amount: 1000,
          description: 'e2e 지출',
          identityKey: 'e2e-cov-txn-1',
          contentHash: 'h1',
          classStatus: 'CLASSIFIED',
          isTransfer: false,
        },
        {
          // 월 경계: 지난달 말일 23:50(KST 자릿수 UTC 저장) — 지난달로 집계돼야 함
          spaceId: SPACE_ID,
          accountId: bankId,
          importId: committedImportId,
          txnDate: boundaryDate,
          direction: 'IN',
          amount: 2000,
          description: 'e2e 월경계',
          identityKey: 'e2e-cov-txn-2',
          contentHash: 'h2',
          classStatus: 'CLASSIFIED',
          isTransfer: false,
        },
      ],
    })

    // DRAFT 임포트(카드) — 이번달 스테이징 3건(미확정 = 검토중)
    const draft = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId: cardId,
        fileName: 'e2e-card-thismonth.csv',
        institution: '하나카드',
        kind: 'CARD',
        status: 'DRAFT',
        totalRows: 3,
      },
    })
    draftImportId = draft.id
    await prisma.finStagedRow.createMany({
      data: [1, 2, 3].map((i) => ({
        spaceId: SPACE_ID,
        importId: draftImportId,
        accountId: cardId,
        raw: {},
        txnDate: monthDate(0, 5 + i),
        direction: 'OUT' as const,
        amount: 100 * i,
        description: `e2e staged ${i}`,
        identityKey: `e2e-cov-staged-${i}`,
        contentHash: `sh${i}`,
      })),
    })
  }, 60000)

  afterAll(async () => {
    await cleanup()
    await prisma.space.delete({ where: { id: SPACE_ID } }).catch(() => {})
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {})
    await prisma.$disconnect()
  }, 60000)

  it('coverage: 확정 거래는 confirmed, 월 경계(말일 23:50)도 해당 월로 집계', async () => {
    const res = await call(coverageGet(getRequest('/api/finance/coverage?months=3')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.months).toHaveLength(3)
    expect(body.months[2]).toBe(monthKey(0))

    const bank = body.accounts.find((a: { id: string }) => a.id === bankId)
    expect(bank).toBeDefined()
    // 지난달: 정오 1건 + 월 경계 23:50 1건 = 2건 모두 지난달로 (UTC 변환 버그 회귀 방지)
    expect(bank.cells[monthKey(1)]).toEqual({ confirmed: 2, staged: 0 })
    expect(bank.cells[monthKey(0)]).toBeUndefined()
    expect(bank.lastImportAt).not.toBeNull()
  })

  it('coverage: DRAFT 스테이징은 staged(검토중)로 집계', async () => {
    const res = await call(coverageGet(getRequest('/api/finance/coverage?months=3')))
    const body = await res.json()
    const card = body.accounts.find((a: { id: string }) => a.id === cardId)
    expect(card.cells[monthKey(0)]).toEqual({ confirmed: 0, staged: 3 })
  })

  it('coverage: accountId 필터', async () => {
    const res = await call(
      coverageGet(getRequest(`/api/finance/coverage?months=3&accountId=${bankId}`))
    )
    const body = await res.json()
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0].id).toBe(bankId)
  })

  it('coverage: months 범위 검증', async () => {
    const res = await call(coverageGet(getRequest('/api/finance/coverage?months=999')))
    expect(res.status).toBe(400)
  })

  it('imports: 목록 최신순 + 계좌 정보 포함', async () => {
    const res = await call(importsGet(getRequest('/api/finance/imports')))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(2)
    const ids = body.imports.map((r: { id: string }) => r.id)
    expect(ids).toContain(draftImportId)
    expect(ids).toContain(committedImportId)
    // createdAt desc — 나중에 만든 draft가 앞
    expect(ids[0]).toBe(draftImportId)
    const draft = body.imports[0]
    expect(draft.status).toBe('DRAFT')
    expect(draft.account.id).toBe(cardId)
  })

  it('imports: accountId 필터', async () => {
    const res = await call(importsGet(getRequest(`/api/finance/imports?accountId=${bankId}`)))
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.imports[0].id).toBe(committedImportId)
    expect(body.imports[0].status).toBe('COMMITTED')
  })

  it('imports: limit 검증', async () => {
    const res = await call(importsGet(getRequest('/api/finance/imports?limit=9999')))
    expect(res.status).toBe(400)
  })
})
