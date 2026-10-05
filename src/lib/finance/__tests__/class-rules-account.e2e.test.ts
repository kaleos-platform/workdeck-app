/** @jest-environment node */
/**
 * 자동 분류 규칙 계좌 단위 e2e — 계좌 전용 학습·시드 공통 생성·규칙 API(Task 3)·알림(Task 4).
 * dev DB throwaway space. DATABASE_URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number, extra?: Record<string, unknown>) =>
    new Response(JSON.stringify({ message, ...extra }), { status }),
}))

import { resolveDeckContext } from '@/lib/api-helpers'
import { learnRule, loadSpaceRules, classifyRow } from '@/lib/finance/classify'
import { PATCH as txnPatch } from '../../../../app/api/finance/transactions/[id]/route'
import { GET as rulesGet, POST as rulesPost } from '../../../../app/api/finance/rules/route'
import {
  PATCH as rulePatch,
  DELETE as ruleDelete,
} from '../../../../app/api/finance/rules/[id]/route'
import { POST as rulePreview } from '../../../../app/api/finance/rules/preview/route'
import { GET as rulesLookup } from '../../../../app/api/finance/rules/lookup/route'
import { PATCH as stagingPatch } from '../../../../app/api/finance/staging/[id]/route'

const SPACE_ID = 'e2e0fin0-0000-4000-8000-0000000000f1'
const USER_ID = 'e2e0fin0-0000-4000-8000-0000000000f2'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.spaceMember.deleteMany({ where: { userId: USER_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })
}

d('finance class rules by account (dev DB)', () => {
  let accA: string
  let accB: string
  let catSales: string
  let catCogs: string
  let catCogs2: string

  beforeAll(async () => {
    await cleanup()
    await prisma.user.create({ data: { id: USER_ID, email: 'e2e-fin-rules@throwaway.test' } })
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E FinRules' } })
    await prisma.spaceMember.create({ data: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' } })
    const acc = (name: string) =>
      prisma.finAccount.create({
        data: { spaceId: SPACE_ID, name, kind: 'BANK', institution: '테스트은행' },
        select: { id: true },
      })
    accA = (await acc('계좌A')).id
    accB = (await acc('계좌B')).id
    const cat = async (name: string, type: 'INCOME' | 'EXPENSE') => {
      const parent = await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, name: `${name}그룹`, type },
        select: { id: true },
      })
      return (
        await prisma.finCategory.create({
          data: { spaceId: SPACE_ID, parentId: parent.id, name, type },
          select: { id: true },
        })
      ).id
    }
    catSales = await cat('매출', 'INCOME')
    catCogs = await cat('매입', 'EXPENSE')
    catCogs2 = await cat('외주', 'EXPENSE')
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: SPACE_ID } })
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  test('계좌 A·B 의 같은 적요는 서로 다른 규칙으로 학습되고 덮어쓰지 않는다', async () => {
    const input = { description: 'bz뱅크', counterparty: null }
    const a = await learnRule(SPACE_ID, input, catCogs, 'OUT', accA)
    const b = await learnRule(SPACE_ID, input, catCogs2, 'OUT', accB)
    expect(a!.ruleId).not.toBe(b!.ruleId)
    const rules = await loadSpaceRules(SPACE_ID)
    expect(classifyRow(input, rules, 'OUT', accA).categoryId).toBe(catCogs)
    expect(classifyRow(input, rules, 'OUT', accB).categoryId).toBe(catCogs2)
  })

  test('같은 계좌 재학습은 갱신 + previousCategoryId 반환', async () => {
    const input = { description: 'bz뱅크', counterparty: null }
    const again = await learnRule(SPACE_ID, input, catCogs2, 'OUT', accA)
    expect(again!.previousCategoryId).toBe(catCogs)
    const rules = await prisma.finClassRule.findMany({
      where: { spaceId: SPACE_ID, accountId: accA },
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].categoryId).toBe(catCogs2)
  })

  test('거래 PATCH 학습은 그 거래 계좌 전용 규칙을 만든다', async () => {
    const txn = await prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId: accB,
        direction: 'IN',
        amount: 1000,
        txnDate: new Date('2026-03-01T00:00:00Z'),
        description: '스마트스토어정산',
        identityKey: 'e2e-rules-1',
        contentHash: 'h1',
      },
      select: { id: true },
    })
    const res = await txnPatch(
      jsonReq(`http://localhost/api/finance/transactions/${txn.id}`, 'PATCH', {
        categoryId: catSales,
      }),
      { params: Promise.resolve({ id: txn.id }) }
    )
    expect(res!.status).toBe(200)
    const rule = await prisma.finClassRule.findFirst({
      where: { spaceId: SPACE_ID, matchKey: '스마트스토어정산' },
    })
    expect(rule!.accountId).toBe(accB)
  })

  describe('규칙 API', () => {
    let ruleId: string
    const mk = (
      id: string,
      accountId: string,
      description: string,
      categoryId: string | null,
      date = '2026-04-01'
    ) =>
      prisma.finTransaction.create({
        data: {
          spaceId: SPACE_ID,
          accountId,
          direction: 'OUT',
          amount: 100,
          txnDate: new Date(`${date}T00:00:00Z`),
          description,
          categoryId,
          classStatus: categoryId ? 'CLASSIFIED' : 'UNCLASSIFIED',
          identityKey: id,
          contentHash: id,
        },
        select: { id: true },
      })

    beforeAll(async () => {
      await mk('u1', accA, '택배 CJ', catCogs)
      await mk('u2', accA, '택배 한진', catCogs)
      await mk('u3', accA, '택배 우체국', catCogs2) // 이후 사용자가 다른 계정으로 바꾼 거래
      await mk('u4', accB, '택배 CJ', catCogs)
    })

    test('POST: 계좌 A 부분포함 규칙 생성, 같은 조건 재생성은 409', async () => {
      const body = { matchKey: '택배', matchType: 'KEYWORD', categoryId: catCogs, accountId: accA }
      const res = await rulesPost(jsonReq('http://localhost/api/finance/rules', 'POST', body))
      expect(res!.status).toBe(201)
      ruleId = (await res!.json()).rule.id
      const dup = await rulesPost(jsonReq('http://localhost/api/finance/rules', 'POST', body))
      expect(dup!.status).toBe(409)
      expect((await dup!.json()).existing.id).toBe(ruleId)
    })

    test('GET: 계좌·사용 현황(텍스트 매칭, 계좌 A 만 3건)', async () => {
      const json = await (await rulesGet())!.json()
      const r = json.rules.find((x: { id: string }) => x.id === ruleId)
      expect(r.account.id).toBe(accA)
      expect(r.usage.count).toBe(3)
    })

    test('preview: 건수·같은 계정과목 건수', async () => {
      const json = await (await rulePreview(
        jsonReq('http://localhost/api/finance/rules/preview', 'POST', {
          matchKey: '택배',
          matchType: 'KEYWORD',
          accountId: accA,
          categoryId: catCogs,
        })
      ))!.json()
      expect(json.count).toBe(3)
      expect(json.sameCategoryCount).toBe(2)
      expect(json.samples.length).toBeLessThanOrEqual(5)
    })

    test('PATCH applyToExisting: 같은 계정과목 거래만 변경, 수동 변경 거래 유지', async () => {
      const res = await rulePatch(
        jsonReq(`http://localhost/api/finance/rules/${ruleId}`, 'PATCH', {
          categoryId: catCogs2,
          applyToExisting: true,
        }),
        { params: Promise.resolve({ id: ruleId }) }
      )
      expect(res!.status).toBe(200)
      expect((await res!.json()).updatedTransactions).toBe(2)
      const b = await prisma.finTransaction.findFirst({
        where: { spaceId: SPACE_ID, identityKey: 'u4' },
      })
      expect(b!.categoryId).toBe(catCogs) // 계좌 B 는 범위 밖
    })

    test('PATCH 충돌 409 — 같은 계좌·키·방향 규칙이 이미 있으면', async () => {
      const other = await rulesPost(
        jsonReq('http://localhost/api/finance/rules', 'POST', {
          matchKey: '택배 cj',
          matchType: 'KEYWORD',
          categoryId: catCogs,
          accountId: accA,
        })
      )
      const otherId = (await other!.json()).rule.id
      const res = await rulePatch(
        jsonReq(`http://localhost/api/finance/rules/${otherId}`, 'PATCH', { matchKey: '택배' }),
        { params: Promise.resolve({ id: otherId }) }
      )
      expect(res!.status).toBe(409)
    })

    test('DELETE: 대기 행을 남은 규칙으로 재분류', async () => {
      // 공통 규칙 + 계좌 규칙이 둘 다 걸리는 대기 행 → 계좌 규칙 삭제 후 공통 규칙으로
      const common = await rulesPost(
        jsonReq('http://localhost/api/finance/rules', 'POST', {
          matchKey: '택배',
          matchType: 'KEYWORD',
          categoryId: catCogs,
          accountId: null,
        })
      )
      const commonId = (await common!.json()).rule.id
      const imp = await prisma.finImport.create({
        data: {
          spaceId: SPACE_ID,
          accountId: accA,
          fileName: 'r.csv',
          institution: '테스트은행',
          kind: 'BANK',
          status: 'DRAFT',
        },
        select: { id: true },
      })
      const staged = await prisma.finStagedRow.create({
        data: {
          importId: imp.id,
          spaceId: SPACE_ID,
          accountId: accA,
          raw: {},
          txnDate: new Date('2026-05-01T00:00:00Z'),
          direction: 'OUT',
          amount: 10,
          description: '택배 로젠',
          categoryId: catCogs2,
          classStatus: 'REVIEW',
          matchedRuleId: ruleId,
          identityKey: 's1',
          contentHash: 's1',
        },
        select: { id: true },
      })
      const res = await ruleDelete(
        jsonReq(`http://localhost/api/finance/rules/${ruleId}`, 'DELETE'),
        { params: Promise.resolve({ id: ruleId }) }
      )
      expect((await res!.json()).reclassifiedStaged).toBeGreaterThanOrEqual(1)
      const row = await prisma.finStagedRow.findUnique({ where: { id: staged.id } })
      expect(row!.matchedRuleId).toBe(commonId)
      expect(row!.categoryId).toBe(catCogs)
    })
  })

  describe('덮어쓰기·우선 적용 알림', () => {
    const q = (p: Record<string, string>) =>
      new NextRequest(`http://localhost/api/finance/rules/lookup?${new URLSearchParams(p)}`)

    test('공통 규칙 적용 중 → OVERRIDES, 같은 키 계좌 규칙 → REPLACED, 같은 계정과목 → null', async () => {
      await prisma.finClassRule.create({
        data: {
          spaceId: SPACE_ID,
          accountId: null,
          matchKey: '알림테스트',
          matchType: 'EXACT',
          direction: 'OUT',
          categoryId: catCogs,
          learnedFrom: 'USER',
        },
      })
      const base = {
        accountId: accA,
        direction: 'OUT',
        description: '알림테스트',
        counterparty: '',
      }
      let json = await (await rulesLookup(q({ ...base, categoryId: catCogs2 })))!.json()
      expect(json.notice.kind).toBe('OVERRIDES')
      json = await (await rulesLookup(q({ ...base, categoryId: catCogs })))!.json()
      expect(json.notice).toBeNull()
      await learnRule(SPACE_ID, { description: '알림테스트' }, catCogs, 'OUT', accA)
      json = await (await rulesLookup(q({ ...base, categoryId: catCogs2 })))!.json()
      expect(json.notice.kind).toBe('REPLACED')
    })
  })

  describe('리뷰 수정', () => {
    let catTransfer: string
    let impId: string

    beforeAll(async () => {
      const parent = await prisma.finCategory.create({
        data: { spaceId: SPACE_ID, name: '이체그룹', type: 'TRANSFER' },
        select: { id: true },
      })
      catTransfer = (
        await prisma.finCategory.create({
          data: { spaceId: SPACE_ID, parentId: parent.id, name: '계좌이체', type: 'TRANSFER' },
          select: { id: true },
        })
      ).id
      impId = (
        await prisma.finImport.create({
          data: {
            spaceId: SPACE_ID,
            accountId: accA,
            fileName: 'fix.csv',
            institution: '테스트은행',
            kind: 'BANK',
            status: 'DRAFT',
          },
          select: { id: true },
        })
      ).id
    })

    test('I-1: 규칙 저장 없이 직접 바꾼 대기 행은 규칙 수정 후에도 유지', async () => {
      const rule = await prisma.finClassRule.create({
        data: {
          spaceId: SPACE_ID,
          accountId: accA,
          matchKey: '수정테스트',
          matchType: 'EXACT',
          direction: 'OUT',
          categoryId: catCogs,
          learnedFrom: 'USER',
        },
      })
      const row = await prisma.finStagedRow.create({
        data: {
          importId: impId,
          spaceId: SPACE_ID,
          accountId: accA,
          raw: {},
          txnDate: new Date('2026-06-01T00:00:00Z'),
          direction: 'OUT',
          amount: 10,
          description: '수정테스트',
          categoryId: catCogs,
          classStatus: 'CLASSIFIED',
          matchedRuleId: rule.id,
          identityKey: 'fix-1',
          contentHash: 'fix-1',
        },
        select: { id: true },
      })
      await stagingPatch(
        jsonReq(`http://localhost/api/finance/staging/${row.id}`, 'PATCH', {
          categoryId: catCogs2,
          learn: false,
        }),
        { params: Promise.resolve({ id: row.id }) }
      )
      await rulePatch(
        jsonReq(`http://localhost/api/finance/rules/${rule.id}`, 'PATCH', { memo: '메모만 수정' }),
        { params: Promise.resolve({ id: rule.id }) }
      )
      const after = await prisma.finStagedRow.findUnique({ where: { id: row.id } })
      expect(after!.categoryId).toBe(catCogs2)
    })

    test('I-2: applyToExisting 은 그 규칙이 실제 적용되는 거래만 바꾼다', async () => {
      // 공통 KEYWORD '정산테스트' → 매입, 계좌 A EXACT '정산테스트 쿠팡' → 매입
      const common = await prisma.finClassRule.create({
        data: {
          spaceId: SPACE_ID,
          accountId: null,
          matchKey: '정산테스트',
          matchType: 'KEYWORD',
          direction: 'OUT',
          categoryId: catCogs,
          learnedFrom: 'USER',
        },
      })
      await prisma.finClassRule.create({
        data: {
          spaceId: SPACE_ID,
          accountId: accA,
          matchKey: '정산테스트 쿠팡',
          matchType: 'EXACT',
          direction: 'OUT',
          categoryId: catCogs,
          learnedFrom: 'USER',
        },
      })
      const mk = (key: string, accountId: string, description: string) =>
        prisma.finTransaction.create({
          data: {
            spaceId: SPACE_ID,
            accountId,
            direction: 'OUT',
            amount: 1,
            txnDate: new Date('2026-06-02T00:00:00Z'),
            description,
            categoryId: catCogs,
            classStatus: 'CLASSIFIED',
            identityKey: key,
            contentHash: key,
          },
          select: { id: true },
        })
      const shadowed = await mk('fix-2a', accA, '정산테스트 쿠팡') // 계좌 EXACT 가 관할
      const owned = await mk('fix-2b', accB, '정산테스트 쿠팡') // 계좌 B 엔 EXACT 없음 → 공통 규칙 관할
      const pv = await (await rulePreview(
        jsonReq('http://localhost/api/finance/rules/preview', 'POST', {
          matchKey: '정산테스트',
          matchType: 'KEYWORD',
          accountId: null,
          categoryId: catCogs,
          ruleId: common.id,
        })
      ))!.json()
      expect(pv.applicableCount).toBe(1) // 팝업 「기존 거래 N건」 = 실제 변경 수
      const res = await rulePatch(
        jsonReq(`http://localhost/api/finance/rules/${common.id}`, 'PATCH', {
          categoryId: catCogs2,
          applyToExisting: true,
        }),
        { params: Promise.resolve({ id: common.id }) }
      )
      expect((await res!.json()).updatedTransactions).toBe(1)
      expect(
        (await prisma.finTransaction.findUnique({ where: { id: shadowed.id } }))!.categoryId
      ).toBe(catCogs)
      expect(
        (await prisma.finTransaction.findUnique({ where: { id: owned.id } }))!.categoryId
      ).toBe(catCogs2)
    })

    test('I-3: 이체 규칙은 메모만 수정해도 방향이 유지된다', async () => {
      const inRule = await prisma.finClassRule.create({
        data: {
          spaceId: SPACE_ID,
          accountId: accA,
          matchKey: '이체테스트',
          matchType: 'EXACT',
          direction: 'IN',
          categoryId: catTransfer,
          learnedFrom: 'USER',
        },
      })
      const outRule = await prisma.finClassRule.create({
        data: {
          spaceId: SPACE_ID,
          accountId: accA,
          matchKey: '이체테스트',
          matchType: 'EXACT',
          direction: 'OUT',
          categoryId: catTransfer,
          learnedFrom: 'USER',
        },
      })
      const r1 = await rulePatch(
        jsonReq(`http://localhost/api/finance/rules/${inRule.id}`, 'PATCH', { memo: 'a' }),
        { params: Promise.resolve({ id: inRule.id }) }
      )
      expect(r1!.status).toBe(200)
      expect((await prisma.finClassRule.findUnique({ where: { id: inRule.id } }))!.direction).toBe(
        'IN'
      )
      const r2 = await rulePatch(
        jsonReq(`http://localhost/api/finance/rules/${outRule.id}`, 'PATCH', { memo: 'b' }),
        { params: Promise.resolve({ id: outRule.id }) }
      )
      expect(r2!.status).toBe(200)
    })
  })
})
