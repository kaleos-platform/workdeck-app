/** @jest-environment node */
/**
 * 재무 관리 Deck — 실제 라우트 핸들러 통합 E2E (dev DB + 실 샘플 파일).
 * getUser만 mock하고 실제 핸들러를 호출한다. afterAll에서 Fin* + DeckInstance를 모두 정리해
 * 측정했던 0-state를 복원한다.
 *
 * 실행 전제: .env.local(dev DB) + docs/source_ref 샘플 파일. 둘 중 하나라도 없으면 describe.skip.
 */
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SAMPLE_DIR = '/Users/kaleos/projects/workdeck-app/docs/source_ref'
const BANK_FILE = path.join(SAMPLE_DIR, 'fianance_data_기업은행.csv')
const CARD_FILE = path.join(SAMPLE_DIR, 'fianance_data_하나카드.csv')
const SPACE_ID = '78377ae5-6614-4a40-9998-d0c392f9083b'
const USER_ID = '797f43e4-3a8b-4ea6-a248-5da21376b663'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL) && fs.existsSync(BANK_FILE)

let mockUserId = ''
jest.mock('@/hooks/use-user', () => ({
  getUser: async () => (mockUserId ? { id: mockUserId } : null),
}))

import { prisma } from '@/lib/prisma'
import { seedFinanceCategories } from '@/lib/finance/kifrs-seed'
import { previewFinanceFile, type FinKind } from '@/lib/finance/parser'
import { autoMapFinHeaders } from '@/lib/finance/automap'
import { NextRequest } from 'next/server'

import { POST as commitStaging } from '../../../../app/api/finance/imports/commit-staging/route'
import { GET as stagingGet } from '../../../../app/api/finance/staging/route'
import { PATCH as stagingPatch } from '../../../../app/api/finance/staging/[id]/route'
import { POST as stagingCommit } from '../../../../app/api/finance/staging/commit/route'
import { GET as dashboardGet } from '../../../../app/api/finance/dashboard/route'
import { GET as cashflowGet } from '../../../../app/api/finance/cashflow/route'

const d = RUN ? describe : describe.skip

/**
 * 라우트 핸들러는 런타임에 항상 NextResponse를 반환하지만, resolveDeckContext의 유니온
 * narrowing 한계(성공 멤버에 `error?: undefined`가 붙어 `'error' in resolved` 검사가 좁혀지지
 * 않음)로 추론 반환 타입에 `| undefined`가 섞인다. 런타임엔 발생 불가하므로 정의됨을 단언한다.
 * (근본 수정은 공유 api-helpers 몫 — 별도 PR 권장.)
 */
async function call<T>(p: Promise<T | undefined>): Promise<T> {
  const r = await p
  if (r == null) throw new Error('route handler returned undefined')
  return r
}

function readArrayBuffer(filePath: string): ArrayBuffer {
  const buf = fs.readFileSync(filePath)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function mappingJson(filePath: string, kind: FinKind): string {
  const preview = previewFinanceFile(readArrayBuffer(filePath))
  return JSON.stringify(autoMapFinHeaders(preview.headers, kind))
}

function uploadRequest(filePath: string, fields: Record<string, string>): NextRequest {
  const buf = fs.readFileSync(filePath)
  const fd = new FormData()
  fd.append('file', new File([buf], path.basename(filePath), { type: 'text/csv' }))
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new NextRequest('http://localhost/api/finance/imports/commit-staging', {
    method: 'POST',
    body: fd,
  })
}

async function cleanup() {
  await prisma.finTransaction.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finStagedRow.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finBalanceSnapshot.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finImport.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finMappingPreset.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finClassRule.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finCategory.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finLiability.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finAccount.deleteMany({ where: { spaceId: SPACE_ID } })
}

d('finance 라우트 E2E (실제 핸들러)', () => {
  let accountId = ''
  let importId = ''
  let expenseLeafId = ''
  let incomeLeafId = ''
  let anchorMonth = ''

  beforeAll(async () => {
    mockUserId = USER_ID
    await cleanup()
    await prisma.deckApp.upsert({
      where: { id: 'finance' },
      update: { isActive: true },
      create: { id: 'finance', name: '재무 관리', isActive: true },
    })
    await prisma.deckInstance.upsert({
      where: { spaceId_deckAppId: { spaceId: SPACE_ID, deckAppId: 'finance' } },
      update: { isActive: true },
      create: { spaceId: SPACE_ID, deckAppId: 'finance', isActive: true },
    })
    await seedFinanceCategories(SPACE_ID, { withRules: true })

    const account = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '기업은행 테스트', kind: 'BANK', institution: '기업은행' },
      select: { id: true },
    })
    accountId = account.id

    const expense = await prisma.finCategory.findFirst({
      where: { spaceId: SPACE_ID, type: 'EXPENSE', parentId: { not: null } },
      select: { id: true },
    })
    const income = await prisma.finCategory.findFirst({
      where: { spaceId: SPACE_ID, type: 'INCOME', parentId: { not: null } },
      select: { id: true },
    })
    expenseLeafId = expense!.id
    incomeLeafId = income!.id
  }, 60000)

  afterAll(async () => {
    await cleanup()
    await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID, deckAppId: 'finance' } })
    const remaining = await prisma.finCategory.count({ where: { spaceId: SPACE_ID } })
    expect(remaining).toBe(0) // 0-state 복원 확인
    await prisma.$disconnect()
  }, 60000)

  test('계정과목 시드: K-IFRS 트리 + SEED 규칙', async () => {
    const cats = await prisma.finCategory.count({ where: { spaceId: SPACE_ID } })
    const rules = await prisma.finClassRule.count({
      where: { spaceId: SPACE_ID, learnedFrom: 'SEED' },
    })
    expect(cats).toBeGreaterThan(10)
    expect(rules).toBeGreaterThan(5)
  })

  test('commit-staging: 실제 은행 파일 파싱 → 분류 → 스테이징 (신규)', async () => {
    const req = uploadRequest(BANK_FILE, {
      accountId,
      kind: 'BANK',
      mapping: mappingJson(BANK_FILE, 'BANK'),
      institution: '기업은행',
      savePreset: 'true',
      presetName: '기업은행',
    })
    const res = await call(commitStaging(req))
    expect(res.status).toBe(201)
    const body = await res.json()
    importId = body.importId
    expect(body.counts.total).toBeGreaterThan(0)
    expect(body.counts.new).toBe(body.counts.total) // 최초 임포트 = 전부 신규
    // 프리셋 저장 확인
    const preset = await prisma.finMappingPreset.findFirst({
      where: { spaceId: SPACE_ID, name: '기업은행' },
    })
    expect(preset).not.toBeNull()
  }, 30000)

  test('staging GET: 대기열 + 탭 카운트', async () => {
    const req = new NextRequest(`http://localhost/api/finance/staging?importId=${importId}`)
    const res = await call(stagingGet(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows.length).toBeGreaterThan(0)
    expect(body.counts.total).toBeGreaterThan(0)
  })

  test('staging PATCH: 미분류 행 분류 → 규칙 학습(EXACT)', async () => {
    const row = await prisma.finStagedRow.findFirst({
      where: { importId, classStatus: 'UNCLASSIFIED' },
      select: { id: true, description: true, counterparty: true },
    })
    // 미분류 행이 없을 수도 있으니(전부 매칭) 가드
    if (!row) {
      const any = await prisma.finStagedRow.findFirst({ where: { importId }, select: { id: true } })
      expect(any).not.toBeNull()
      return
    }
    const req = new NextRequest(`http://localhost/api/finance/staging/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId: expenseLeafId }),
    })
    const res = await call(stagingPatch(req, { params: Promise.resolve({ id: row.id }) }))
    expect(res.status).toBe(200)
    const updated = await prisma.finStagedRow.findUnique({ where: { id: row.id } })
    expect(updated?.classStatus).toBe('CLASSIFIED')
    expect(updated?.categoryId).toBe(expenseLeafId)
    // 규칙 학습 확인(USER EXACT)
    const learned = await prisma.finClassRule.count({
      where: { spaceId: SPACE_ID, learnedFrom: 'USER' },
    })
    expect(learned).toBeGreaterThan(0)
  }, 20000)

  test('staging/commit: 확정 거래 + 잔고 스냅샷 파생', async () => {
    const req = new NextRequest('http://localhost/api/finance/staging/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ importId }),
    })
    const res = await call(stagingCommit(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.committed).toBeGreaterThan(0)

    const txnCount = await prisma.finTransaction.count({ where: { spaceId: SPACE_ID, accountId } })
    expect(txnCount).toBe(body.committed)
    // 은행 계좌 → 월별 잔고 스냅샷 존재
    const snaps = await prisma.finBalanceSnapshot.count({ where: { spaceId: SPACE_ID, accountId } })
    expect(snaps).toBeGreaterThan(0)

    const first = await prisma.finTransaction.findFirst({
      where: { spaceId: SPACE_ID, accountId },
      select: { txnDate: true },
      orderBy: { txnDate: 'desc' },
    })
    const dt = first!.txnDate
    anchorMonth = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }, 30000)

  test('재임포트 dedup: 동일 파일 → 전부 중복(DUP_SAME)', async () => {
    const req = uploadRequest(BANK_FILE, {
      accountId,
      kind: 'BANK',
      mapping: mappingJson(BANK_FILE, 'BANK'),
      institution: '기업은행',
    })
    const res = await call(commitStaging(req))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.counts.dupSame).toBe(body.counts.total)
    expect(body.counts.new).toBe(0)
  }, 30000)

  test('Fix A: DUP_CHANGED 재임포트가 사용자 분류를 덮어쓰지 않음', async () => {
    // 사용자가 직접 분류한 확정 거래
    const txn = await prisma.finTransaction.findFirst({
      where: { spaceId: SPACE_ID, accountId },
      select: { id: true, identityKey: true, direction: true, amount: true, txnDate: true },
    })
    await prisma.finTransaction.update({
      where: { id: txn!.id },
      data: {
        categoryId: expenseLeafId,
        classStatus: 'CLASSIFIED',
        description: '원래적요',
        contentHash: 'orig',
      },
    })

    // 같은 identityKey의 DUP_CHANGED 스테이징(자동분류는 다른 계정 + 콘텐츠 변경)
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'fixA',
        institution: '기업은행',
        kind: 'BANK',
        status: 'DRAFT',
        totalRows: 1,
      },
      select: { id: true },
    })
    await prisma.finStagedRow.create({
      data: {
        importId: imp.id,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: txn!.txnDate,
        direction: txn!.direction,
        amount: txn!.amount,
        description: '변경된적요',
        categoryId: incomeLeafId, // 다른(자동) 분류
        classStatus: 'CLASSIFIED',
        identityKey: txn!.identityKey,
        contentHash: 'changed',
        resolution: 'DUP_CHANGED',
      },
    })

    const req = new NextRequest('http://localhost/api/finance/staging/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ importId: imp.id }),
    })
    const res = await call(stagingCommit(req))
    expect(res.status).toBe(200)

    const after = await prisma.finTransaction.findUnique({ where: { id: txn!.id } })
    expect(after?.categoryId).toBe(expenseLeafId) // 사용자 분류 보존(income으로 안 바뀜)
    expect(after?.description).toBe('변경된적요') // 콘텐츠는 갱신
    expect(after?.contentHash).toBe('changed')
  }, 30000)

  test('dashboard: KPI + 계좌 스냅샷 집계', async () => {
    const req = new NextRequest(
      `http://localhost/api/finance/dashboard?period=month&anchor=${anchorMonth}`
    )
    const res = await call(dashboardGet(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kpi).toBeDefined()
    expect(typeof body.kpi.totalCash).toBe('number')
    expect(Array.isArray(body.trend)).toBe(true)
    expect(body.accountSnapshots.some((a: { id: string }) => a.id === accountId)).toBe(true)
    // 지출이 있으면 expenseTop 비어있지 않음
    expect(Array.isArray(body.expenseTop)).toBe(true)
  }, 20000)

  test('cashflow: 기간 버킷 + 수입/지출 행', async () => {
    const req = new NextRequest(
      `http://localhost/api/finance/cashflow?grain=month&from=${anchorMonth}&to=${anchorMonth}`
    )
    const res = await call(cashflowGet(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.buckets)).toBe(true)
    expect(body.buckets.length).toBeGreaterThan(0)
    expect(body.totals).toBeDefined()
  }, 20000)

  test('Fix2: 방향-type 충돌 거래는 대시보드·현금흐름 모두 지출로 집계', async () => {
    const ym = '2025-09'
    await prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        txnDate: new Date(2025, 8, 15), // 2025-09 (로컬)
        direction: 'OUT',
        amount: 50000,
        categoryId: incomeLeafId, // INCOME type 계정에 OUT 거래(오분류 시나리오)
        classStatus: 'CLASSIFIED',
        isTransfer: false,
        identityKey: 'fix2-conflict-key',
        contentHash: 'fix2',
      },
    })

    const dashRes = await call(
      dashboardGet(
        new NextRequest(`http://localhost/api/finance/dashboard?period=month&anchor=${ym}`)
      )
    )
    const dash = await dashRes.json()
    expect(dash.kpi.expense).toBeGreaterThanOrEqual(50000)

    const cfRes = await call(
      cashflowGet(
        new NextRequest(`http://localhost/api/finance/cashflow?grain=month&from=${ym}&to=${ym}`)
      )
    )
    const cf = await cfRes.json()
    // OUT은 계정과목 type과 무관하게 지출 섹션 — 대시보드와 동일 기준
    expect(cf.totals.expense.values[ym]).toBe(dash.kpi.expense)
    expect(cf.totals.income.values[ym] ?? 0).toBe(0)
  }, 20000)

  test('카드 파일 파싱 smoke (하나카드)', async () => {
    if (!fs.existsSync(CARD_FILE)) return
    const card = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '하나카드 테스트', kind: 'CARD', institution: '하나카드' },
      select: { id: true },
    })
    const req = uploadRequest(CARD_FILE, {
      accountId: card.id,
      kind: 'CARD',
      mapping: mappingJson(CARD_FILE, 'CARD'),
      institution: '하나카드',
    })
    const res = await call(commitStaging(req))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.counts.total).toBeGreaterThan(0)
  }, 30000)
})
