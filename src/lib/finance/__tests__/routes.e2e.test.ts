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

const SAMPLE_DIR = path.resolve(process.cwd(), 'docs/finace-ops/source_ref')
const BANK_FILE = path.join(SAMPLE_DIR, 'fianance_data_기업은행.csv')
const CARD_FILE = path.join(SAMPLE_DIR, 'fianance_data_하나카드.csv')
// 전용 throwaway space/user — 실 데이터(특히 운영 의식주의·실 유저)를 절대 건드리지 않도록 격리.
// 핸들러는 USER_ID의 SpaceMember로 space를 해석하므로 space·user·membership을 모두 더미로 둔다.
// beforeAll에서 생성, afterAll에서 space 삭제(member/deckInstance/Fin* cascade)+user 삭제로 0-state 복원.
const SPACE_ID = 'e2e00000-0000-4000-8000-000000000001'
const USER_ID = 'e2e00000-0000-4000-8000-000000000002'

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
import {
  GET as accountsGet,
  POST as accountsPost,
} from '../../../../app/api/finance/accounts/route'
import { PATCH as accountPatch } from '../../../../app/api/finance/accounts/[id]/route'
import { GET as stagingGet } from '../../../../app/api/finance/staging/route'
import { PATCH as stagingPatch } from '../../../../app/api/finance/staging/[id]/route'
import { POST as stagingBulk } from '../../../../app/api/finance/staging/bulk/route'
import { loadSpaceRules, classifyRow, matchKeyOf } from '@/lib/finance/classify'
import { PATCH as transactionPatch } from '../../../../app/api/finance/transactions/[id]/route'
import { GET as transactionsGet } from '../../../../app/api/finance/transactions/route'
import { POST as stagingCommit } from '../../../../app/api/finance/staging/commit/route'
import { GET as dashboardGet } from '../../../../app/api/finance/dashboard/route'
import { GET as cashflowGet } from '../../../../app/api/finance/cashflow/route'
import { GET as sankeyGet } from '../../../../app/api/finance/cashflow/sankey/route'

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
    // 전용 throwaway user/space/membership(멱등) — 실 space를 절대 사용하지 않는다.
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-finance@throwaway.test', name: 'E2E Finance' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Finance Throwaway', type: 'PERSONAL' },
    })
    await prisma.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: SPACE_ID, userId: USER_ID } },
      update: {},
      create: { spaceId: SPACE_ID, userId: USER_ID, role: 'OWNER' },
    })
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

    // 운영 차트는 2단계(대분류 → 운영 항목). 분류 타깃은 리프(부모가 대분류 = 부모의 parentId도 not null).
    const expense = await prisma.finCategory.findFirst({
      where: { spaceId: SPACE_ID, type: 'EXPENSE', parent: { parentId: { not: null } } },
      select: { id: true },
    })
    const income = await prisma.finCategory.findFirst({
      where: { spaceId: SPACE_ID, type: 'INCOME', parent: { parentId: { not: null } } },
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
    // 전용 throwaway 정리 — space 삭제가 member/deckInstance/Fin*를 cascade, user도 삭제.
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  }, 60000)

  test('계정과목 시드: 운영 차트 트리 + SEED 규칙', async () => {
    const cats = await prisma.finCategory.count({ where: { spaceId: SPACE_ID } })
    const rules = await prisma.finClassRule.count({
      where: { spaceId: SPACE_ID, learnedFrom: 'SEED' },
    })
    expect(cats).toBeGreaterThan(10)
    expect(rules).toBeGreaterThan(5)
  })

  test('accounts CRUD: 계좌 이름과 예금주를 별도 저장·조회·수정', async () => {
    const createReq = new NextRequest('http://localhost/api/finance/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '기업은행 운영 구분명',
        holder: '주식회사 워크덱',
        kind: 'BANK',
        institution: '기업은행',
        accountNumber: 'holder-e2e-001',
      }),
    })
    const createRes = await call(accountsPost(createReq))
    expect(createRes.status).toBe(201)
    const created = await createRes.json()
    expect(created.account.name).toBe('기업은행 운영 구분명')
    expect(created.account.holder).toBe('주식회사 워크덱')

    const updateReq = new NextRequest(
      `http://localhost/api/finance/accounts/${created.account.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ holder: '워크덱컴퍼니' }),
      }
    )
    const updateRes = await call(
      accountPatch(updateReq, { params: Promise.resolve({ id: created.account.id }) })
    )
    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json()
    expect(updated.account.name).toBe('기업은행 운영 구분명')
    expect(updated.account.holder).toBe('워크덱컴퍼니')

    const listRes = await call(accountsGet())
    expect(listRes.status).toBe(200)
    const list = await listRes.json()
    expect(
      list.accounts.some(
        (account: { id: string; name: string; holder: string | null }) =>
          account.id === created.account.id &&
          account.name === '기업은행 운영 구분명' &&
          account.holder === '워크덱컴퍼니'
      )
    ).toBe(true)
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

  // 같은 파일 재업로드 — 미확정(DRAFT) 스테이징 행과도 dedup 되어 큐에 두 벌 쌓이지 않아야 한다.
  test('commit-staging: 같은 파일 재업로드 → 전부 DUP(신규 0)', async () => {
    // 한 행의 contentHash를 오염시켜 DUP_CHANGED 경로도 함께 검증.
    // identityKey가 배치 내에서 고유한 행을 골라야 stagedMap(Map, 마지막 값 유지)에 확실히 반영된다.
    const allRows = await prisma.finStagedRow.findMany({
      where: { importId },
      select: { id: true, contentHash: true, identityKey: true },
    })
    const keyCounts = new Map<string, number>()
    for (const row of allRows)
      keyCounts.set(row.identityKey, (keyCounts.get(row.identityKey) ?? 0) + 1)
    const victim = allRows.find((row) => keyCounts.get(row.identityKey) === 1)
    expect(victim).toBeDefined()
    await prisma.finStagedRow.update({
      where: { id: victim!.id },
      data: { contentHash: 'e2e-bogus-hash' },
    })

    const req = uploadRequest(BANK_FILE, {
      accountId,
      kind: 'BANK',
      mapping: mappingJson(BANK_FILE, 'BANK'),
      institution: '기업은행',
    })
    const res = await call(commitStaging(req))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.counts.new).toBe(0) // 전 행이 기존 DRAFT 스테이징과 중복
    expect(body.counts.dupChanged).toBeGreaterThanOrEqual(1) // 오염 행 = content 상이
    expect(body.counts.dupSame + body.counts.dupChanged).toBe(body.counts.total)

    // 재업로드분은 검증 후 제거 + 오염 복원 — 이후 테스트 상태 오염 방지
    await prisma.finStagedRow.deleteMany({ where: { importId: body.importId } })
    await prisma.finImport.deleteMany({ where: { id: body.importId } })
    await prisma.finStagedRow.update({
      where: { id: victim!.id },
      data: { contentHash: victim!.contentHash },
    })
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

  // staging/commit(신 모델): 분류완료(CLASSIFIED 비-DUP_SAME) 행만 확정 거래로 커밋 + staged 행 delete.
  // 임포트 무관(importId 주면 한정). 확정 거래=source of truth, 영향 계좌 월말 잔고 스냅샷 파생.
  test('staging/commit: 분류완료 행 확정 거래 + staged 삭제 + 잔고 스냅샷 파생', async () => {
    // 커밋 대상(분류완료 비-DUP_SAME) 행 수 — 커밋 후 전부 삭제되어야 한다.
    const committableBefore = await prisma.finStagedRow.count({
      where: { importId, classStatus: 'CLASSIFIED', resolution: { not: 'DUP_SAME' } },
    })
    expect(committableBefore).toBeGreaterThan(0)

    const req = new NextRequest('http://localhost/api/finance/staging/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ importId }),
    })
    const res = await call(stagingCommit(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.committed).toBe(committableBefore) // 분류완료 행만 커밋

    const txnCount = await prisma.finTransaction.count({ where: { spaceId: SPACE_ID, accountId } })
    expect(txnCount).toBe(body.committed)
    // 신 모델: 커밋된 분류완료 행은 큐에서 제거(확정 거래=source of truth)
    const remainingCommittable = await prisma.finStagedRow.count({
      where: { importId, classStatus: 'CLASSIFIED', resolution: { not: 'DUP_SAME' } },
    })
    expect(remainingCommittable).toBe(0)
    // 은행 계좌 → 월별 잔고 스냅샷 존재
    const snaps = await prisma.finBalanceSnapshot.count({ where: { spaceId: SPACE_ID, accountId } })
    expect(snaps).toBeGreaterThan(0)

    // 계좌 기준(현재) 잔액 자동 갱신 — 최신 일자 거래의 balanceAfter/txnDate
    const latestTxn = await prisma.finTransaction.findFirst({
      where: { spaceId: SPACE_ID, accountId, balanceAfter: { not: null } },
      select: { balanceAfter: true, txnDate: true },
      orderBy: { txnDate: 'desc' },
    })
    const acctAfter = await prisma.finAccount.findUnique({
      where: { id: accountId },
      select: { currentBalance: true, currentBalanceAsOf: true },
    })
    if (latestTxn) {
      expect(acctAfter?.currentBalance).not.toBeNull()
      expect(Number(acctAfter!.currentBalance)).toBe(Number(latestTxn.balanceAfter))
      expect(acctAfter?.currentBalanceAsOf?.getTime()).toBe(latestTxn.txnDate.getTime())
    }

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

  // 저장 처리 시 중복 제외(DUP_SAME) 행은 자동 정리 — 큐에 영구 잔류하지 않는다.
  test('staging/commit: DUP_SAME 행 자동 정리(dupCleaned)', async () => {
    const dupBefore = await prisma.finStagedRow.count({
      where: { spaceId: SPACE_ID, resolution: 'DUP_SAME' },
    })
    expect(dupBefore).toBeGreaterThan(0) // 직전 재임포트로 쌓인 중복

    const req = new NextRequest('http://localhost/api/finance/staging/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await call(stagingCommit(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dupCleaned).toBe(dupBefore)

    const dupAfter = await prisma.finStagedRow.count({
      where: { spaceId: SPACE_ID, resolution: 'DUP_SAME' },
    })
    expect(dupAfter).toBe(0)
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

  test('Fix B: DUP_OVERWRITE("유지" 명시)는 사용자 계정과목을 덮어씀', async () => {
    // Fix A가 건드린 첫 거래와 겹치지 않도록 두 번째 거래를 사용
    const txns = await prisma.finTransaction.findMany({
      where: { spaceId: SPACE_ID, accountId },
      select: { id: true, identityKey: true, direction: true, amount: true, txnDate: true },
      orderBy: { txnDate: 'asc' },
      take: 2,
    })
    const target = txns[1] ?? txns[0]
    await prisma.finTransaction.update({
      where: { id: target.id },
      data: {
        categoryId: expenseLeafId,
        classStatus: 'CLASSIFIED',
        description: '원래적요B',
        contentHash: 'origB',
      },
    })

    // 사용자가 "유지"(DUP_OVERWRITE) 선택 + 다른 계정과목 지정
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'fixB',
        institution: '기업은행',
        kind: 'BANK',
        status: 'DRAFT',
        totalRows: 1,
      },
      select: { id: true },
    })
    // 임포트 직후 상태(중복·미분류)로 스테이징 행 생성
    const staged = await prisma.finStagedRow.create({
      data: {
        importId: imp.id,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: target.txnDate,
        direction: target.direction,
        amount: target.amount,
        description: '변경된적요B',
        categoryId: null,
        classStatus: 'UNCLASSIFIED',
        identityKey: target.identityKey,
        contentHash: 'changedB',
        resolution: 'DUP_SAME',
      },
      select: { id: true },
    })

    // 실제 사용자 흐름: ① "유지" 클릭(resolution PATCH) → ② 계정과목 변경(categoryId PATCH)
    const patch = (payload: object) =>
      call(
        stagingPatch(
          new NextRequest(`http://localhost/api/finance/staging/${staged.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          { params: Promise.resolve({ id: staged.id }) }
        )
      )
    expect((await patch({ resolution: 'DUP_OVERWRITE' })).status).toBe(200)
    // 방향 가드(OUT 행에 INCOME 계정 400) 도입으로 행 방향에 맞는 계정과목 사용
    const overwriteLeafId = target.direction === 'OUT' ? expenseLeafId : incomeLeafId
    expect((await patch({ categoryId: overwriteLeafId })).status).toBe(200)

    // 계정과목 PATCH 후에도 resolution 이 DUP_OVERWRITE 로 보존돼야 함(회귀 가드)
    const mid = await prisma.finStagedRow.findUnique({
      where: { id: staged.id },
      select: { resolution: true, classStatus: true },
    })
    expect(mid?.resolution).toBe('DUP_OVERWRITE')
    expect(mid?.classStatus).toBe('CLASSIFIED')

    const req = new NextRequest('http://localhost/api/finance/staging/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ importId: imp.id }),
    })
    const res = await call(stagingCommit(req))
    expect(res.status).toBe(200)

    const after = await prisma.finTransaction.findUnique({ where: { id: target.id } })
    expect(after?.categoryId).toBe(overwriteLeafId) // 덮어쓰기(사용자 지정 계정으로 변경됨)
    expect(after?.description).toBe('변경된적요B') // 콘텐츠도 갱신
    expect(after?.contentHash).toBe('changedB')
  }, 30000)

  test('메모: staging PATCH 저장(trim)·빈 문자열 삭제·길이 초과 400', async () => {
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'memo-staging',
        institution: '기업은행',
        kind: 'BANK',
        status: 'DRAFT',
        totalRows: 1,
      },
      select: { id: true },
    })
    const staged = await prisma.finStagedRow.create({
      data: {
        importId: imp.id,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-07-01T00:00:00Z'),
        direction: 'OUT',
        amount: 1000,
        description: '메모테스트행',
        classStatus: 'UNCLASSIFIED',
        identityKey: 'memo-staged-1',
        contentHash: 'memo-staged-1',
      },
      select: { id: true },
    })
    const patch = (payload: object) =>
      call(
        stagingPatch(
          new NextRequest(`http://localhost/api/finance/staging/${staged.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          { params: Promise.resolve({ id: staged.id }) }
        )
      )

    // 저장 — trim 검증
    expect((await patch({ memo: '  회식비 처리 ' })).status).toBe(200)
    let row = await prisma.finStagedRow.findUnique({ where: { id: staged.id } })
    expect(row?.memo).toBe('회식비 처리')

    // 빈 문자열 → 삭제(null)
    expect((await patch({ memo: '' })).status).toBe(200)
    row = await prisma.finStagedRow.findUnique({ where: { id: staged.id } })
    expect(row?.memo).toBeNull()

    // 길이 초과 → 400
    expect((await patch({ memo: 'a'.repeat(501) })).status).toBe(400)

    await prisma.finStagedRow.delete({ where: { id: staged.id } })
    await prisma.finImport.delete({ where: { id: imp.id } })
  }, 20000)

  test('분류 확인: learn=false → 규칙 미생성 + 분류·메모만 반영(완료 처리)', async () => {
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'classify-nolearn',
        institution: '기업은행',
        kind: 'BANK',
        status: 'DRAFT',
        totalRows: 1,
      },
      select: { id: true },
    })
    const staged = await prisma.finStagedRow.create({
      data: {
        importId: imp.id,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-07-02T00:00:00Z'),
        direction: 'OUT',
        amount: 7000,
        description: '규칙미학습분류행',
        classStatus: 'UNCLASSIFIED',
        identityKey: 'classify-nolearn-1',
        contentHash: 'classify-nolearn-1',
      },
      select: { id: true },
    })
    const rulesBefore = await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })

    const req = new NextRequest(`http://localhost/api/finance/staging/${staged.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId: expenseLeafId, learn: false, memo: '일회성 지출' }),
    })
    const res = await call(stagingPatch(req, { params: Promise.resolve({ id: staged.id }) }))
    expect(res.status).toBe(200)

    const after = await prisma.finStagedRow.findUnique({ where: { id: staged.id } })
    expect(after?.classStatus).toBe('CLASSIFIED')
    expect(after?.categoryId).toBe(expenseLeafId)
    expect(after?.memo).toBe('일회성 지출')
    // 규칙 미생성
    expect(await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })).toBe(rulesBefore)

    await prisma.finStagedRow.delete({ where: { id: staged.id } })
    await prisma.finImport.delete({ where: { id: imp.id } })
  }, 20000)

  test('분류 확인: learn=true + memo → 규칙에 memo 저장, 자동분류 시 ruleMemo 반환', async () => {
    const DESC = '규칙메모학습행'
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'classify-learn-memo',
        institution: '기업은행',
        kind: 'BANK',
        status: 'DRAFT',
        totalRows: 1,
      },
      select: { id: true },
    })
    const staged = await prisma.finStagedRow.create({
      data: {
        importId: imp.id,
        spaceId: SPACE_ID,
        accountId,
        raw: {},
        txnDate: new Date('2026-07-02T00:00:00Z'),
        direction: 'OUT',
        amount: 8000,
        description: DESC,
        classStatus: 'UNCLASSIFIED',
        identityKey: 'classify-learn-memo-1',
        contentHash: 'classify-learn-memo-1',
      },
      select: { id: true },
    })

    const req = new NextRequest(`http://localhost/api/finance/staging/${staged.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categoryId: expenseLeafId, learn: true, memo: '정기 구독료' }),
    })
    const res = await call(stagingPatch(req, { params: Promise.resolve({ id: staged.id }) }))
    expect(res.status).toBe(200)

    // 규칙에 memo 저장 확인
    const learned = await prisma.finClassRule.findFirst({
      where: { spaceId: SPACE_ID, matchKey: matchKeyOf({ description: DESC }), direction: 'OUT' },
    })
    expect(learned?.memo).toBe('정기 구독료')

    // 자동분류 체인(loadSpaceRules → classifyRow)이 ruleMemo를 반환 — 업로드 시 이 값이 행 memo로 복사됨
    const rules = await loadSpaceRules(SPACE_ID)
    const cls = classifyRow({ description: DESC }, rules, 'OUT')
    expect(cls.classStatus).toBe('CLASSIFIED')
    expect(cls.ruleMemo).toBe('정기 구독료')

    await prisma.finStagedRow.delete({ where: { id: staged.id } })
    await prisma.finClassRule.deleteMany({ where: { id: learned!.id } })
    await prisma.finImport.delete({ where: { id: imp.id } })
  }, 20000)

  test('staging/bulk: memo 일괄 적용 + 규칙 미생성 (동일 적요 자동 적용 경로)', async () => {
    const imp = await prisma.finImport.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        fileName: 'bulk-memo',
        institution: '기업은행',
        kind: 'BANK',
        status: 'DRAFT',
        totalRows: 2,
      },
      select: { id: true },
    })
    const mk = (n: number) =>
      prisma.finStagedRow.create({
        data: {
          importId: imp.id,
          spaceId: SPACE_ID,
          accountId,
          raw: {},
          txnDate: new Date('2026-07-03T00:00:00Z'),
          direction: 'OUT',
          amount: 100 * n,
          description: `벌크메모행${n}`,
          classStatus: 'UNCLASSIFIED',
          identityKey: `bulk-memo-${n}`,
          contentHash: `bulk-memo-${n}`,
        },
        select: { id: true },
      })
    const r1 = await mk(1)
    const r2 = await mk(2)
    const rulesBefore = await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })

    const req = new NextRequest('http://localhost/api/finance/staging/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [r1.id, r2.id], categoryId: expenseLeafId, memo: '형제 메모' }),
    })
    const res = await call(stagingBulk(req))
    expect(res.status).toBe(200)
    expect((await res.json()).updated).toBe(2)

    const rows = await prisma.finStagedRow.findMany({ where: { id: { in: [r1.id, r2.id] } } })
    for (const row of rows) {
      expect(row.classStatus).toBe('CLASSIFIED')
      expect(row.memo).toBe('형제 메모')
    }
    expect(await prisma.finClassRule.count({ where: { spaceId: SPACE_ID } })).toBe(rulesBefore)

    await prisma.finStagedRow.deleteMany({ where: { id: { in: [r1.id, r2.id] } } })
    await prisma.finImport.delete({ where: { id: imp.id } })
  }, 20000)

  test('메모: commit 이관 + staged memo=null은 기존 확정 거래 메모 미덮어쓰기', async () => {
    // 기존 거래·집계 테스트를 오염시키지 않도록 격리: 신규 identityKey + 과거 날짜(집계 범위 밖)
    // + balanceAfter 없음(스냅샷·기준잔액 무영향). 테스트 끝에 생성 거래 삭제로 0-state 복원.
    const IDENTITY = 'memo-commit-isolated'
    const TXN_DATE = new Date('2020-01-15T00:00:00Z')

    const mkImport = (name: string) =>
      prisma.finImport.create({
        data: {
          spaceId: SPACE_ID,
          accountId,
          fileName: name,
          institution: '기업은행',
          kind: 'BANK',
          status: 'DRAFT',
          totalRows: 1,
        },
        select: { id: true },
      })
    const mkStaged = (importId: string, memo: string | null, resolution: 'NEW' | 'DUP_OVERWRITE') =>
      prisma.finStagedRow.create({
        data: {
          importId,
          spaceId: SPACE_ID,
          accountId,
          raw: {},
          txnDate: TXN_DATE,
          direction: 'OUT',
          amount: 1000,
          description: '메모이관행',
          categoryId: expenseLeafId,
          classStatus: 'CLASSIFIED' as const,
          identityKey: IDENTITY,
          contentHash: 'memo-commit',
          resolution,
          memo,
        },
        select: { id: true },
      })
    const commit = (importId: string) =>
      call(
        stagingCommit(
          new NextRequest('http://localhost/api/finance/staging/commit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ importId }),
          })
        )
      )
    const findTxn = () =>
      prisma.finTransaction.findUnique({
        where: {
          spaceId_accountId_identityKey: { spaceId: SPACE_ID, accountId, identityKey: IDENTITY },
        },
      })

    // ① staged memo 있음 → 신규 확정 거래 생성 시 이관
    const imp1 = await mkImport('memo-commit-1')
    await mkStaged(imp1.id, '이관될 메모', 'NEW')
    expect((await commit(imp1.id)).status).toBe(200)
    let txn = await findTxn()
    expect(txn?.memo).toBe('이관될 메모')

    // ② staged memo=null(재업로드분) 재커밋 → 기존 메모 보존 (DUP_OVERWRITE=분류 덮어쓰기여도)
    const imp2 = await mkImport('memo-commit-2')
    await mkStaged(imp2.id, null, 'DUP_OVERWRITE')
    expect((await commit(imp2.id)).status).toBe(200)
    txn = await findTxn()
    expect(txn?.memo).toBe('이관될 메모')

    // 격리 정리 — 생성 거래·임포트 제거(집계 테스트 무영향 보장)
    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: IDENTITY },
    })
    await prisma.finImport.deleteMany({ where: { id: { in: [imp1.id, imp2.id] } } })
  }, 30000)

  test('메모: transactions PATCH 저장/삭제 + GET 응답 포함', async () => {
    const target = await prisma.finTransaction.findFirst({
      where: { spaceId: SPACE_ID, accountId },
      select: { id: true },
    })
    expect(target).not.toBeNull()
    const patch = (payload: object) =>
      call(
        transactionPatch(
          new NextRequest(`http://localhost/api/finance/transactions/${target!.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }),
          { params: Promise.resolve({ id: target!.id }) }
        )
      )

    // 저장 + 응답 body 포함
    const saveRes = await patch({ memo: '확정 거래 메모' })
    expect(saveRes.status).toBe(200)
    const saveBody = await saveRes.json()
    expect(saveBody.transaction.memo).toBe('확정 거래 메모')

    // GET 목록 응답에 memo 포함
    const listRes = await call(
      transactionsGet(
        new NextRequest(`http://localhost/api/finance/transactions?accountId=${accountId}`)
      )
    )
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json()
    const found = (listBody.rows as { id: string; memo: string | null }[]).find(
      (r) => r.id === target!.id
    )
    expect(found?.memo).toBe('확정 거래 메모')

    // null → 삭제
    expect((await patch({ memo: null })).status).toBe(200)
    const after = await prisma.finTransaction.findUnique({ where: { id: target!.id } })
    expect(after?.memo).toBeNull()
  }, 20000)

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
      `http://localhost/api/finance/cashflow?grain=month&periods=${anchorMonth}`
    )
    const res = await call(cashflowGet(req))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.buckets)).toBe(true)
    expect(body.buckets.length).toBeGreaterThan(0)
    expect(body.totals).toBeDefined()
  }, 20000)

  test('cashflow: 리프 단위 행 + 대분류 메타(parentId/parentName/flowRole) + 합산 정합', async () => {
    // 매출 대분류(MERCH_SALES) 리프에 수입, COGS 리프에 지출 생성.
    const ym = '2024-05'
    const merchLeaf = await leafUnderFlowRole('MERCH_SALES', 'INCOME')
    const cogsLeaf = await leafUnderFlowRole('COGS', 'EXPENSE')
    await makeTxn(ym, 'IN', 800_000, merchLeaf, 'cf-merch')
    await makeTxn(ym, 'OUT', 300_000, cogsLeaf, 'cf-cogs')

    const res = await call(
      cashflowGet(
        new NextRequest(`http://localhost/api/finance/cashflow?grain=month&periods=${ym}`)
      )
    )
    const body = await res.json()

    // 행은 리프 단위 + 상위 대분류 메타를 실어야 함.
    const rows = [...body.incomeRows, ...body.expenseRows]
    for (const r of rows) {
      expect(r).toHaveProperty('parentId')
      expect(r).toHaveProperty('parentName')
      expect(r).toHaveProperty('flowRole')
    }
    // 매출 리프 행이 flowRole=MERCH_SALES로 실렸는지.
    const merchRow = body.incomeRows.find(
      (r: { values: Record<string, number> }) => r.values[ym] === 800_000
    )
    expect(merchRow?.flowRole).toBe('MERCH_SALES')
    // 리프를 parentId로 합산 == 섹션 total.
    const incomeSum = body.incomeRows.reduce(
      (a: number, r: { values: Record<string, number> }) => a + (r.values[ym] ?? 0),
      0
    )
    expect(Math.round(incomeSum)).toBe(Math.round(body.totals.income.values[ym]))

    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: { startsWith: 'cf-' } },
    })
  }, 30000)

  test('cashflow periods: 비연속 선택 → 그 버킷만 + 갭 기간 거래 미포함(NaN 없음)', async () => {
    const anyLeaf = await leafUnderFlowRole('MERCH_SALES', 'INCOME')
    // 1월·3월·5월 거래 생성. 1·5월만 선택하면 3월은 집계 제외되어야 함.
    await makeTxn('2024-01', 'IN', 100_000, anyLeaf, 'per-jan')
    await makeTxn('2024-03', 'IN', 999_000, anyLeaf, 'per-mar') // 갭(미선택)
    await makeTxn('2024-05', 'IN', 200_000, anyLeaf, 'per-may')

    const res = await call(
      cashflowGet(
        new NextRequest('http://localhost/api/finance/cashflow?grain=month&periods=2024-01,2024-05')
      )
    )
    const body = await res.json()
    expect(body.buckets).toEqual(['2024-01', '2024-05']) // 비연속, 오름차순
    expect(body.totals.income.values['2024-01']).toBe(100_000)
    expect(body.totals.income.values['2024-05']).toBe(200_000)
    // 갭(3월)은 어떤 버킷에도 없음 + NaN 없음
    expect(body.totals.income.values['2024-03']).toBeUndefined()
    for (const v of Object.values(body.totals.income.values as Record<string, number>)) {
      expect(Number.isNaN(v)).toBe(false)
    }
    // 3월 999,000이 새어들어오지 않았는지(합 = 30만)
    const sum = Object.values(body.totals.income.values as Record<string, number>).reduce(
      (a, b) => a + b,
      0
    )
    expect(sum).toBe(300_000)

    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: { startsWith: 'per-' } },
    })
  }, 30000)

  test('cashflow 기본(periods 없음): 직전월까지 최근 6개, 현재월 미포함', async () => {
    const res = await call(
      cashflowGet(new NextRequest('http://localhost/api/finance/cashflow?grain=month'))
    )
    const body = await res.json()
    expect(body.buckets.length).toBe(6)
    // 오름차순
    expect([...body.buckets].sort()).toEqual(body.buckets)
    // 현재월(로컬) 미포함
    const now = new Date()
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(body.buckets).not.toContain(curYm)
  }, 20000)

  test('sankey 기본: 직전월 단일 기간', async () => {
    const res = await call(
      sankeyGet(new NextRequest('http://localhost/api/finance/cashflow/sankey?grain=month'))
    )
    const body = await res.json()
    const now = new Date()
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    // period.from/to = 직전월(현재월 아님)
    expect(body.period.to).not.toBe(curYm)
    expect(body.period.from).toBe(body.period.to)
  }, 20000)

  test('sankey period: 특정 기간 선택 → 그 기간 집계 + 라벨', async () => {
    const ym = '2024-06'
    const merchLeaf = await leafUnderFlowRole('MERCH_SALES', 'INCOME')
    await makeTxn(ym, 'IN', 700_000, merchLeaf, 'skp-merch')

    const res = await call(
      sankeyGet(
        new NextRequest(`http://localhost/api/finance/cashflow/sankey?grain=month&period=${ym}`)
      )
    )
    const body = await res.json()
    expect(body.period.from).toBe(ym)
    expect(body.period.to).toBe(ym)
    expect(body.period.label).toBe('2024년 6월')
    expect(body.totals.totalIncome).toBe(700_000) // 그 기간 집계

    // 무효 period → 기본(직전월) 폴백
    const res2 = await call(
      sankeyGet(
        new NextRequest('http://localhost/api/finance/cashflow/sankey?grain=month&period=bad')
      )
    )
    const body2 = await res2.json()
    const now = new Date()
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    expect(body2.period.to).not.toBe(curYm)

    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: { startsWith: 'skp-' } },
    })
  }, 30000)

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
        new NextRequest(`http://localhost/api/finance/cashflow?grain=month&periods=${ym}`)
      )
    )
    const cf = await cfRes.json()
    // OUT은 계정과목 type과 무관하게 지출 섹션 — 대시보드와 동일 기준
    expect(cf.totals.expense.values[ym]).toBe(dash.kpi.expense)
    expect(cf.totals.income.values[ym] ?? 0).toBe(0)
  }, 20000)

  // ── 손익 흐름도(Sankey) ─────────────────────────────────────────────────────
  /** 지정 flowRole 대분류의 리프 id. null이면 flowRole 미태그(기타) 대분류의 리프. */
  async function leafUnderFlowRole(
    role: 'MERCH_SALES' | 'COGS' | 'OPEX' | 'FINANCING_COST' | null,
    type: 'INCOME' | 'EXPENSE'
  ): Promise<string> {
    // level-1 대분류 = 부모가 루트(parent.parentId === null). 리프도 flowRole null이라 이 조건 필수.
    const parent = await prisma.finCategory.findFirst({
      where: { spaceId: SPACE_ID, type, flowRole: role, parent: { parentId: null } },
      select: { id: true },
    })
    if (!parent) throw new Error(`flowRole=${role} type=${type} 대분류 없음`)
    const leaf = await prisma.finCategory.findFirst({
      where: { spaceId: SPACE_ID, parentId: parent.id },
      select: { id: true },
    })
    if (!leaf) throw new Error(`flowRole=${role} 대분류의 리프 없음`)
    return leaf.id
  }

  async function makeTxn(
    ym: string,
    direction: 'IN' | 'OUT',
    amount: number,
    categoryId: string,
    key: string,
    cancelFlag: string | null = null
  ): Promise<void> {
    const [y, m] = ym.split('-').map(Number)
    await prisma.finTransaction.create({
      data: {
        spaceId: SPACE_ID,
        accountId,
        txnDate: new Date(y, m - 1, 15),
        direction,
        amount,
        categoryId,
        cancelFlag,
        classStatus: 'CLASSIFIED',
        isTransfer: false,
        identityKey: key,
        contentHash: key,
      },
    })
  }

  test('sankey: 손익 워터폴 + net 불변식 + 노드 균형', async () => {
    const ym = '2024-03' // 샘플 데이터와 겹치지 않는 격리 월
    const merchLeaf = await leafUnderFlowRole('MERCH_SALES', 'INCOME')
    const cogsLeaf = await leafUnderFlowRole('COGS', 'EXPENSE')
    const opexLeaf = await leafUnderFlowRole('OPEX', 'EXPENSE')
    const finLeaf = await leafUnderFlowRole('FINANCING_COST', 'EXPENSE')
    const otherLeaf = await leafUnderFlowRole(null, 'INCOME') // 기타수입(미태그)

    await makeTxn(ym, 'IN', 1_000_000, merchLeaf, 'sk-merch')
    await makeTxn(ym, 'IN', 50_000, otherLeaf, 'sk-other')
    await makeTxn(ym, 'OUT', 400_000, cogsLeaf, 'sk-cogs')
    await makeTxn(ym, 'OUT', 200_000, opexLeaf, 'sk-opex')
    await makeTxn(ym, 'OUT', 30_000, finLeaf, 'sk-fin')

    const res = await call(
      sankeyGet(
        new NextRequest(`http://localhost/api/finance/cashflow/sankey?grain=month&period=${ym}`)
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.renderable).toBe(true)
    // 손익 계층 값
    expect(body.totals.totalIncome).toBe(1_050_000)
    expect(body.totals.merchSales).toBe(1_000_000)
    expect(body.totals.cogs).toBe(400_000)
    expect(body.totals.grossProfit).toBe(600_000) // 매출총이익 = 상품매출 − 매출원가
    expect(body.totals.opex).toBe(200_000)
    expect(body.totals.operatingProfit).toBe(450_000) // 600k + 50k − 200k
    expect(body.totals.financingCost).toBe(30_000)
    expect(body.totals.net).toBe(420_000) // 1,050k − 400k − 200k − 30k

    // 핵심 불변식: Sankey net == cashflow 테이블 net (같은 기간)
    const cfRes = await call(
      cashflowGet(
        new NextRequest(`http://localhost/api/finance/cashflow?grain=month&periods=${ym}`)
      )
    )
    const cf = await cfRes.json()
    expect(body.totals.net).toBe(cf.totals.net.values[ym])

    // 노드 균형: 중간 노드는 inflow == outflow
    const nodes: { name: string }[] = body.nodes
    const links: { source: number; target: number; value: number }[] = body.links
    const inflow = (i: number) =>
      links.filter((l) => l.target === i).reduce((a, l) => a + l.value, 0)
    const outflow = (i: number) =>
      links.filter((l) => l.source === i).reduce((a, l) => a + l.value, 0)
    nodes.forEach((_, i) => {
      const isSource = links.some((l) => l.source === i)
      const isTarget = links.some((l) => l.target === i)
      if (isSource && isTarget) {
        expect(Math.abs(inflow(i) - outflow(i))).toBeLessThan(1) // 반올림 허용
      }
    })

    // 정리(다음 테스트 격리)
    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: { startsWith: 'sk-' } },
    })
  }, 30000)

  test('sankey: 음수 기타수익(취소·환불)에도 net == 테이블 net (불변식 유지)', async () => {
    const ym = '2024-04'
    const merchLeaf = await leafUnderFlowRole('MERCH_SALES', 'INCOME')
    const otherLeaf = await leafUnderFlowRole(null, 'INCOME')
    await makeTxn(ym, 'IN', 1_000_000, merchLeaf, 'skneg-merch')
    // 취소 income(cancelFlag='취소') → signedAmount 음수 → 기타수익 버킷 음수
    await makeTxn(ym, 'IN', 50_000, otherLeaf, 'skneg-cancel', '취소')

    const res = await call(
      sankeyGet(
        new NextRequest(`http://localhost/api/finance/cashflow/sankey?grain=month&period=${ym}`)
      )
    )
    const body = await res.json()

    // 총계·net은 전체(음수 포함) 기준 — 테이블과 반드시 일치
    expect(body.totals.totalIncome).toBe(950_000)
    expect(body.totals.net).toBe(950_000)
    const cfRes = await call(
      cashflowGet(
        new NextRequest(`http://localhost/api/finance/cashflow?grain=month&periods=${ym}`)
      )
    )
    const cf = await cfRes.json()
    expect(body.totals.net).toBe(cf.totals.net.values[ym])
    // 음수 버킷이 있으면 흐름도는 못 그림(균형 깨짐 방지)
    expect(body.renderable).toBe(false)

    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: { startsWith: 'skneg-' } },
    })
  }, 30000)

  test('sankey: 적자(매출원가>상품매출) 기간은 renderable:false', async () => {
    const ym = '2024-02'
    const merchLeaf = await leafUnderFlowRole('MERCH_SALES', 'INCOME')
    const cogsLeaf = await leafUnderFlowRole('COGS', 'EXPENSE')
    await makeTxn(ym, 'IN', 100_000, merchLeaf, 'skloss-merch')
    await makeTxn(ym, 'OUT', 200_000, cogsLeaf, 'skloss-cogs')

    const res = await call(
      sankeyGet(
        new NextRequest(`http://localhost/api/finance/cashflow/sankey?grain=month&period=${ym}`)
      )
    )
    const body = await res.json()
    expect(body.renderable).toBe(false)
    expect(typeof body.reason).toBe('string')
    expect(body.totals.grossProfit).toBe(-100_000)

    await prisma.finTransaction.deleteMany({
      where: { spaceId: SPACE_ID, identityKey: { startsWith: 'skloss-' } },
    })
  }, 30000)

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

  // 기준(현재) 잔액 date-gated 갱신: 과거 데이터는 미갱신, 더 최신 데이터만 갱신.
  test('기준잔액 가드: 기준일 이전은 미갱신, 이후만 갱신', async () => {
    // 먼 미래 일자 사용 — 다른 테스트가 만든 거래보다 항상 최신이도록(글로벌 max 보장).
    const anchor = new Date('2099-06-15T00:00:00.000Z')
    const marker = 424242
    // 기준일=anchor, 잔액=marker로 강제 세팅
    await prisma.finAccount.update({
      where: { id: accountId },
      data: { currentBalance: marker, currentBalanceAsOf: anchor },
    })

    const commitOne = async (
      fileName: string,
      txnDate: Date,
      balanceAfter: number,
      key: string
    ) => {
      const imp = await prisma.finImport.create({
        data: {
          spaceId: SPACE_ID,
          accountId,
          fileName,
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
          txnDate,
          direction: 'IN',
          amount: 1000,
          balanceAfter,
          description: key,
          categoryId: incomeLeafId,
          classStatus: 'CLASSIFIED',
          identityKey: key,
          contentHash: key,
          resolution: 'NEW',
        },
      })
      const req = new NextRequest('http://localhost/api/finance/staging/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ importId: imp.id }),
      })
      const res = await call(stagingCommit(req))
      expect(res.status).toBe(200)
    }

    // 1) 기준일 이전(과거) 거래 → currentBalance 미갱신(마커 유지)
    await commitOne('guard-old', new Date('2099-06-14T00:00:00.000Z'), 111, 'guard-old-1')
    const afterOld = await prisma.finAccount.findUnique({
      where: { id: accountId },
      select: { currentBalance: true, currentBalanceAsOf: true },
    })
    expect(Number(afterOld!.currentBalance)).toBe(marker)
    expect(afterOld!.currentBalanceAsOf!.getTime()).toBe(anchor.getTime())

    // 2) 기준일 이후(최신) 거래 → currentBalance 갱신
    const newer = new Date('2099-06-20T00:00:00.000Z')
    await commitOne('guard-new', newer, 777, 'guard-new-1')
    const afterNew = await prisma.finAccount.findUnique({
      where: { id: accountId },
      select: { currentBalance: true, currentBalanceAsOf: true },
    })
    expect(Number(afterNew!.currentBalance)).toBe(777)
    expect(afterNew!.currentBalanceAsOf!.getTime()).toBe(newer.getTime())
  }, 30000)
})
