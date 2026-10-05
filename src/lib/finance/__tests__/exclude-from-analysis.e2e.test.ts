/** @jest-environment node */
/**
 * 「분석 제외」(FinTransaction.excludeFromAnalysis) e2e — 지정 API·재업로드 보존·집계 필터.
 * route handler 를 직접 호출한다. DB 는 실제 dev DB(throwaway space). DATABASE_URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { PATCH as txnPatch } from '../../../../app/api/finance/transactions/[id]/route'
import { POST as txnBulk } from '../../../../app/api/finance/transactions/bulk/route'
import { POST as stagingCommit } from '../../../../app/api/finance/staging/commit/route'

const SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000e1'
const OTHER_SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000e3'
const USER_ID = 'e2e0fin0-0000-4000-8000-0000000000e2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.spaceMember.deleteMany({ where: { userId: USER_ID } })
  await prisma.deckInstance.deleteMany({ where: { spaceId: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
  await prisma.space.deleteMany({ where: { id: { in: [SPACE_ID, OTHER_SPACE_ID] } } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

d('finance exclude-from-analysis (dev DB)', () => {
  let accountId: string
  let incomeCatId: string
  let otherIncomeCatId: string
  let normalTxnId: string
  let excludedTxnId: string
  let otherSpaceTxnId: string

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-fin-exclude@throwaway.test' } })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E FinExclude' } })
    await prisma.space.create({ data: { id: OTHER_SPACE_ID, name: 'E2E FinExclude Other' } })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })

    accountId = (
      await prisma.finAccount.create({
        data: {
          spaceId: SPACE_ID,
          name: '제외테스트계좌',
          kind: 'BANK',
          institution: '테스트은행',
        },
        select: { id: true },
      })
    ).id
    // 실제 트리처럼 대분류 → 리프 구조(현금흐름은 리프를 행으로, 대분류를 메타로 쓴다)
    const parentId = (
      await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, name: '제외테스트수익', type: 'INCOME' },
        select: { id: true },
      })
    ).id
    incomeCatId = (
      await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, parentId, name: '제외테스트매출', type: 'INCOME' },
        select: { id: true },
      })
    ).id
    otherIncomeCatId = (
      await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, parentId, name: '제외테스트기타수익', type: 'INCOME' },
        select: { id: true },
      })
    ).id

    const base = {
      spaceId: SPACE_ID,
      accountId,
      direction: 'IN' as const,
      categoryId: incomeCatId,
      classStatus: 'CLASSIFIED' as const,
    }
    normalTxnId = (
      await prisma.finTransaction.create({
        data: {
          ...base,
          txnDate: new Date('2026-01-10T00:00:00Z'),
          amount: 100000,
          description: '본업 매출',
          identityKey: 'e2e-ex-normal',
          contentHash: 'h-normal',
        },
        select: { id: true },
      })
    ).id
    excludedTxnId = (
      await prisma.finTransaction.create({
        data: {
          ...base,
          txnDate: new Date('2026-01-12T00:00:00Z'),
          amount: 30000,
          description: '외부 계약 매출',
          identityKey: 'e2e-ex-excluded',
          contentHash: 'h-excluded',
        },
        select: { id: true },
      })
    ).id

    const otherAcct = await prisma.finAccount.create({
      data: { spaceId: OTHER_SPACE_ID, name: '남의계좌', kind: 'BANK', institution: '테스트은행' },
      select: { id: true },
    })
    otherSpaceTxnId = (
      await prisma.finTransaction.create({
        data: {
          spaceId: OTHER_SPACE_ID,
          accountId: otherAcct.id,
          direction: 'IN',
          txnDate: new Date('2026-01-10T00:00:00Z'),
          amount: 1,
          identityKey: 'e2e-ex-other',
          contentHash: 'h-other',
        },
        select: { id: true },
      })
    ).id
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: SPACE_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('단건 PATCH 로 분석 제외 지정', async () => {
    const res = await txnPatch(
      jsonReq(`http://localhost/api/finance/transactions/${excludedTxnId}`, 'PATCH', {
        excludeFromAnalysis: true,
      }),
      { params: Promise.resolve({ id: excludedTxnId }) }
    )
    expect(res!.status).toBe(200)
    const json = await res!.json()
    expect(json.transaction.excludeFromAnalysis).toBe(true)
  })

  test('계정과목 재분류는 분석 제외 값을 바꾸지 않는다', async () => {
    const res = await txnPatch(
      jsonReq(`http://localhost/api/finance/transactions/${excludedTxnId}`, 'PATCH', {
        categoryId: otherIncomeCatId,
        learn: false,
      }),
      { params: Promise.resolve({ id: excludedTxnId }) }
    )
    expect(res!.status).toBe(200)
    const row = await prisma.finTransaction.findUnique({ where: { id: excludedTxnId } })
    expect(row!.excludeFromAnalysis).toBe(true)
    // 원복(이후 집계 테스트가 같은 계정과목을 가정)
    await prisma.finTransaction.update({
      where: { id: excludedTxnId },
      data: { categoryId: incomeCatId },
    })
  })

  test('bulk: 다른 space 의 id 는 무시, 자기 space 만 갱신', async () => {
    const res = await txnBulk(
      jsonReq('http://localhost/api/finance/transactions/bulk', 'POST', {
        ids: [normalTxnId, otherSpaceTxnId],
        excludeFromAnalysis: true,
      })
    )
    expect(res!.status).toBe(200)
    expect((await res!.json()).updated).toBe(1)
    const other = await prisma.finTransaction.findUnique({ where: { id: otherSpaceTxnId } })
    expect(other!.excludeFromAnalysis).toBe(false)
    // 해제도 같은 경로
    const res2 = await txnBulk(
      jsonReq('http://localhost/api/finance/transactions/bulk', 'POST', {
        ids: [normalTxnId],
        excludeFromAnalysis: false,
      })
    )
    expect((await res2!.json()).updated).toBe(1)
    const normal = await prisma.finTransaction.findUnique({ where: { id: normalTxnId } })
    expect(normal!.excludeFromAnalysis).toBe(false)
  })

  test.each(['DUP_CHANGED', 'DUP_OVERWRITE'] as const)(
    '재업로드(%s) 커밋 후에도 분석 제외 유지',
    async (resolution) => {
      const imp = await prisma.finImport.create({
        data: {
          spaceId: SPACE_ID,
          accountId,
          fileName: `re-${resolution}.csv`,
          institution: '테스트은행',
          kind: 'BANK',
          status: 'DRAFT',
        },
        select: { id: true },
      })
      await prisma.finStagedRow.create({
        data: {
          importId: imp.id,
          spaceId: SPACE_ID,
          accountId,
          raw: {},
          txnDate: new Date('2026-01-12T00:00:00Z'),
          direction: 'IN',
          amount: 30000,
          description: '외부 계약 매출(수정)',
          categoryId: incomeCatId,
          classStatus: 'CLASSIFIED',
          identityKey: 'e2e-ex-excluded',
          contentHash: `h-changed-${resolution}`,
          resolution,
        },
      })
      const res = await stagingCommit(
        jsonReq('http://localhost/api/finance/staging/commit', 'POST', { importId: imp.id })
      )
      expect(res!.status).toBe(200)
      expect((await res!.json()).committed).toBe(1)
      const row = await prisma.finTransaction.findUnique({ where: { id: excludedTxnId } })
      expect(row!.description).toBe('외부 계약 매출(수정)')
      expect(row!.excludeFromAnalysis).toBe(true)
    }
  )
})
