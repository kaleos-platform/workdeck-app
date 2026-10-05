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
import { PATCH as stagingPatch } from '../../../../app/api/finance/staging/[id]/route'
import { POST as stagingBulk } from '../../../../app/api/finance/staging/bulk/route'
import { GET as cashflowGet } from '../../../../app/api/finance/cashflow/route'
import { GET as dashboardGet } from '../../../../app/api/finance/dashboard/route'
import { GET as sankeyGet } from '../../../../app/api/finance/cashflow/sankey/route'
import { GET as transactionsGet } from '../../../../app/api/finance/transactions/route'
import { GET as exportGet } from '../../../../app/api/finance/export/route'

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

  describe('집계 필터', () => {
    const get = (url: string) => new NextRequest(url)
    beforeAll(async () => {
      // 이체이면서 분석 제외인 거래 — 어떤 경우에도 합계에 들어가면 안 된다(Review Focus 4)
      await prisma.finTransaction.create({
        data: {
          spaceId: SPACE_ID,
          accountId,
          direction: 'IN',
          txnDate: new Date('2026-01-15T00:00:00Z'),
          amount: 7000,
          isTransfer: true,
          excludeFromAnalysis: true,
          identityKey: 'e2e-ex-transfer',
          contentHash: 'h-transfer',
        },
      })
    })

    test('현금흐름: 기본 제외, includeExcluded=1 이면 포함', async () => {
      const off = await (await cashflowGet(
        get('http://localhost/api/finance/cashflow?grain=month&periods=2026-01')
      ))!.json()
      expect(off.totals.income.values['2026-01']).toBe(100000)
      const on = await (await cashflowGet(
        get('http://localhost/api/finance/cashflow?grain=month&periods=2026-01&includeExcluded=1')
      ))!.json()
      expect(on.totals.income.values['2026-01']).toBe(130000)
    })

    test('대시보드: 수입 기본 제외 + excludedCount', async () => {
      const off = await (await dashboardGet(
        get('http://localhost/api/finance/dashboard?period=month&anchor=2026-01')
      ))!.json()
      expect(off.kpi.income).toBe(100000)
      expect(off.excludedCount).toBe(1) // 이체+제외 거래는 세지 않음
      const on = await (await dashboardGet(
        get('http://localhost/api/finance/dashboard?period=month&anchor=2026-01&includeExcluded=1')
      ))!.json()
      expect(on.kpi.income).toBe(130000)
      expect(on.excludedCount).toBe(0)
    })

    test('Sankey: 기본 제외, includeExcluded=1 이면 포함', async () => {
      const off = await (await sankeyGet(
        get('http://localhost/api/finance/cashflow/sankey?grain=month&period=2026-01')
      ))!.json()
      expect(off.totals.totalIncome).toBe(100000)
      const on = await (await sankeyGet(
        get(
          'http://localhost/api/finance/cashflow/sankey?grain=month&period=2026-01&includeExcluded=1'
        )
      ))!.json()
      expect(on.totals.totalIncome).toBe(130000)
    })

    test('거래내역: scope 별 행 + 요약 합계 규칙', async () => {
      const q = 'http://localhost/api/finance/transactions?from=2026-01-01&to=2026-01-31'
      const all = await (await transactionsGet(get(q)))!.json()
      expect(all.total).toBe(3) // 행은 전부(이체 포함)
      expect(all.summary.incomeTotal).toBe(100000) // 요약은 분석 제외·이체 뺌
      expect(all.rows.find((r: { id: string }) => r.id === excludedTxnId).excludeFromAnalysis).toBe(
        true
      )

      const included = await (await transactionsGet(get(`${q}&scope=included`)))!.json()
      expect(included.total).toBe(1)
      expect(included.summary.incomeTotal).toBe(100000)

      const excluded = await (await transactionsGet(get(`${q}&scope=excluded`)))!.json()
      expect(excluded.total).toBe(2) // excluded + transferExcluded
      expect(excluded.summary.incomeTotal).toBe(30000) // 이체는 여전히 합계 제외

      const withInc = await (await transactionsGet(get(`${q}&includeExcluded=1`)))!.json()
      expect(withInc.summary.incomeTotal).toBe(130000)
    })

    test('export: 분석 제외 컬럼', async () => {
      const res = await exportGet(
        get('http://localhost/api/finance/export?from=2026-01-01&to=2026-01-31')
      )
      const csv = await res!.text()
      const [header, ...lines] = csv.replace(/^﻿/, '').split('\r\n')
      // cell() 은 모든 값을 "..." 로 감싼다
      expect(header.split(',')).toContain('"분석제외"')
      const line = lines.find((l) => l.includes('외부 계약 매출'))!
      expect(line.split(',').at(-1)).toBe('"Y"')
      const normalLine = lines.find((l) => l.includes('본업 매출'))!
      expect(normalLine.split(',').at(-1)).toBe('""')
    })
  })

  describe('확인·처리 단계 지정 → 저장 처리 이관', () => {
    // 2026-02 로 두어 1월 집계 테스트와 섞이지 않게 한다.
    let impId: string
    const staged = (identityKey: string, extra: Record<string, unknown> = {}) =>
      prisma.finStagedRow.create({
        data: {
          importId: impId,
          spaceId: SPACE_ID,
          accountId,
          raw: {},
          txnDate: new Date('2026-02-05T00:00:00Z'),
          direction: 'OUT',
          amount: 5000,
          description: `스테이징 ${identityKey}`,
          categoryId: incomeCatId,
          classStatus: 'CLASSIFIED',
          identityKey,
          contentHash: `h-${identityKey}`,
          ...extra,
        },
        select: { id: true },
      })

    beforeAll(async () => {
      impId = (
        await prisma.finImport.create({
          data: {
            spaceId: SPACE_ID,
            accountId,
            fileName: 'staging-exclude.csv',
            institution: '테스트은행',
            kind: 'BANK',
            status: 'DRAFT',
          },
          select: { id: true },
        })
      ).id
    })

    test('단건 PATCH 로 스테이징 행 분석 제외 지정', async () => {
      const { id } = await staged('e2e-st-single')
      const res = await stagingPatch(
        jsonReq(`http://localhost/api/finance/staging/${id}`, 'PATCH', {
          excludeFromAnalysis: true,
        }),
        { params: Promise.resolve({ id }) }
      )
      expect(res!.status).toBe(200)
      expect((await res!.json()).row.excludeFromAnalysis).toBe(true)
    })

    test('bulk 로 스테이징 행 분석 제외 지정/해제', async () => {
      const a = await staged('e2e-st-bulk-a')
      const b = await staged('e2e-st-bulk-b')
      const res = await stagingBulk(
        jsonReq('http://localhost/api/finance/staging/bulk', 'POST', {
          ids: [a.id, b.id],
          excludeFromAnalysis: true,
        })
      )
      expect(res!.status).toBe(200)
      const rows = await prisma.finStagedRow.findMany({ where: { id: { in: [a.id, b.id] } } })
      expect(rows.every((r) => r.excludeFromAnalysis)).toBe(true)
      await stagingBulk(
        jsonReq('http://localhost/api/finance/staging/bulk', 'POST', {
          ids: [b.id],
          excludeFromAnalysis: false,
        })
      )
      const rb = await prisma.finStagedRow.findUnique({ where: { id: b.id } })
      expect(rb!.excludeFromAnalysis).toBe(false)
    })

    test('저장 처리: 신규 거래는 지정값 그대로, 기존 거래는 지정 시에만 true 로 반영', async () => {
      // 기존 확정 거래 2건 — 하나는 false(→ 스테이징 지정으로 true 가 되어야 함), 하나는 true(→ 미지정 재업로드로 풀리면 안 됨)
      const base = {
        spaceId: SPACE_ID,
        accountId,
        direction: 'OUT' as const,
        amount: 5000,
        txnDate: new Date('2026-02-05T00:00:00Z'),
        categoryId: incomeCatId,
        classStatus: 'CLASSIFIED' as const,
      }
      await prisma.finTransaction.create({
        data: { ...base, identityKey: 'e2e-st-dup-false', contentHash: 'old-1' },
      })
      await prisma.finTransaction.create({
        data: {
          ...base,
          identityKey: 'e2e-st-dup-true',
          contentHash: 'old-2',
          excludeFromAnalysis: true,
        },
      })
      await staged('e2e-st-dup-false', { resolution: 'DUP_CHANGED', excludeFromAnalysis: true })
      await staged('e2e-st-dup-true', { resolution: 'DUP_CHANGED', excludeFromAnalysis: false })
      await staged('e2e-st-new', { excludeFromAnalysis: true })

      const res = await stagingCommit(
        jsonReq('http://localhost/api/finance/staging/commit', 'POST', { importId: impId })
      )
      expect(res!.status).toBe(200)

      const byKey = async (identityKey: string) =>
        (await prisma.finTransaction.findFirst({ where: { spaceId: SPACE_ID, identityKey } }))!
          .excludeFromAnalysis
      expect(await byKey('e2e-st-new')).toBe(true)
      expect(await byKey('e2e-st-dup-false')).toBe(true)
      expect(await byKey('e2e-st-dup-true')).toBe(true)
      expect(await byKey('e2e-st-bulk-b')).toBe(false)
    })
  })
})
