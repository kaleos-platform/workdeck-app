/** @jest-environment node */
/**
 * 업로드 매핑 규칙(FinMappingPreset) 라이프사이클 E2E — 실제 라우트 핸들러 + dev DB.
 *
 * 회귀 방어 대상(사용자 보고):
 *   - "적요를 규칙에서 뺐는데 다음 업로드에 다시 붙는다"
 *   - "파일명이 다르면 매번 다른 규칙이 적용되는 것 같다"
 * 규칙 식별은 파일명이 아니라 **파일 형식(헤더 서명)** 이어야 하고, 갱신은 같은 규칙에
 * 떨어져야 한다(신규 규칙이 늘어나면 안 됨). CSV는 합성 — 샘플 파일 의존 없음.
 *
 * 실행 전제: .env.local(dev DB). 없으면 describe.skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

const SPACE_ID = 'e2e00000-0000-4000-8000-000000000011'
const USER_ID = 'e2e00000-0000-4000-8000-000000000012'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)

let mockUserId = ''
jest.mock('@/hooks/use-user', () => ({
  getUser: async () => (mockUserId ? { id: mockUserId } : null),
}))

import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'

import { POST as commitStaging } from '../../../../app/api/finance/imports/commit-staging/route'
import { POST as importPreview } from '../../../../app/api/finance/imports/preview/route'
import { GET as presetsGet } from '../../../../app/api/finance/mapping-presets/route'
import {
  PATCH as presetPatch,
  DELETE as presetDelete,
} from '../../../../app/api/finance/mapping-presets/[id]/route'

const d = RUN ? describe : describe.skip

/** 라우트 핸들러 반환 타입의 `| undefined`(resolveDeckContext narrowing 한계) 흡수. */
async function call<T>(p: Promise<T | undefined>): Promise<T> {
  const r = await p
  if (r == null) throw new Error('route handler returned undefined')
  return r
}

const HEADER_LINE = '거래일시,적요,내용,입금액,출금액,거래후잔액'

/** 같은 형식(헤더)의 CSV — 행 내용만 달리해 중복 판정을 피한다. */
function bankCsv(seed: number): Buffer {
  const rows = [
    `2026-06-0${seed} 10:00:00,급여이체${seed},상세${seed},1000000,,${1000000 * seed}`,
    `2026-06-1${seed} 11:00:00,카드대금${seed},상세${seed},,50000,${1000000 * seed - 50000}`,
  ]
  return Buffer.from([HEADER_LINE, ...rows].join('\n'), 'utf8')
}

function fileFrom(buf: Buffer, fileName: string): File {
  return new File([new Uint8Array(buf)], fileName, { type: 'text/csv' })
}

function previewRequest(buf: Buffer, fileName: string): NextRequest {
  const fd = new FormData()
  fd.append('file', fileFrom(buf, fileName))
  return new NextRequest('http://localhost/api/finance/imports/preview', {
    method: 'POST',
    body: fd,
  })
}

function commitRequest(
  buf: Buffer,
  fileName: string,
  fields: Record<string, string>
): NextRequest {
  const fd = new FormData()
  fd.append('file', fileFrom(buf, fileName))
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return new NextRequest('http://localhost/api/finance/imports/commit-staging', {
    method: 'POST',
    body: fd,
  })
}

type Pair = { headerName: string; field: string }
const BASE_MAPPING: Pair[] = [
  { headerName: '거래일시', field: 'txnDate' },
  { headerName: '입금액', field: 'deposit' },
  { headerName: '출금액', field: 'withdrawal' },
  { headerName: '거래후잔액', field: 'balanceAfter' },
]
/** 적요 + 내용 다중 컬럼(사용자가 문제 삼은 상태) */
const WITH_JEOKYO: Pair[] = [
  ...BASE_MAPPING,
  { headerName: '적요', field: 'description' },
  { headerName: '내용', field: 'description' },
]
/** 적요 제거 — 내용만 */
const WITHOUT_JEOKYO: Pair[] = [...BASE_MAPPING, { headerName: '내용', field: 'description' }]

function descriptionHeaders(mapping: unknown): string[] {
  return (Array.isArray(mapping) ? (mapping as Pair[]) : [])
    .filter((m) => m.field === 'description')
    .map((m) => m.headerName)
}

/**
 * detectKind가 BANK로 오판하는 카드 형식(카드 시그널 토큰 1개만 포함).
 * 저장은 CARD 계좌로 하므로 preview.kind(BANK) ≠ preset.kind(CARD) — 후보를 kind로 좁히면
 * 저장한 규칙이 영영 다시 매칭되지 않는다. 그 사각지대를 막는 회귀 테스트용.
 */
const CARDISH_HEADER = '이용일,가맹점명,이용금액,할부'
function cardishCsv(seed: number): Buffer {
  const rows = [`2026-06-0${seed},가맹점${seed},${1000 * seed},일시불`]
  return Buffer.from([CARDISH_HEADER, ...rows].join('\n'), 'utf8')
}
const CARDISH_MAPPING: Pair[] = [
  { headerName: '이용일', field: 'txnDate' },
  { headerName: '가맹점명', field: 'description' },
  { headerName: '이용금액', field: 'amount' },
]

async function cleanup() {
  await prisma.finStagedRow.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finTransaction.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finImport.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finMappingPreset.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finClassRule.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finCategory.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.finAccount.deleteMany({ where: { spaceId: SPACE_ID } })
}

d('매핑 규칙(프리셋) 라이프사이클 E2E', () => {
  let accountId = ''
  let presetId = ''

  beforeAll(async () => {
    mockUserId = USER_ID
    await prisma.user.upsert({
      where: { id: USER_ID },
      update: {},
      create: { id: USER_ID, email: 'e2e-fin-preset@throwaway.test', name: 'E2E Preset' },
    })
    await prisma.space.upsert({
      where: { id: SPACE_ID },
      update: {},
      create: { id: SPACE_ID, name: 'E2E Preset Throwaway', type: 'PERSONAL' },
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
    const account = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '기업은행 테스트', kind: 'BANK', institution: '기업은행' },
      select: { id: true },
    })
    accountId = account.id
  }, 60000)

  afterAll(async () => {
    await cleanup()
    await prisma.deckInstance.deleteMany({ where: { spaceId: SPACE_ID, deckAppId: 'finance' } })
    await prisma.spaceMember.deleteMany({ where: { spaceId: SPACE_ID } })
    await prisma.space.deleteMany({ where: { id: SPACE_ID } })
    await prisma.user.deleteMany({ where: { id: USER_ID } })
    await prisma.$disconnect()
  }, 60000)

  test('1) 적요+내용 매핑으로 규칙 저장', async () => {
    const res = await call(
      commitStaging(
        commitRequest(bankCsv(1), '기업은행_2026-06.csv', {
          accountId,
          kind: 'BANK',
          mapping: JSON.stringify(WITH_JEOKYO),
          institution: '기업은행',
          savePreset: 'true',
          presetName: '기업은행',
        })
      )
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.presetSaved).toBe(true)

    const presets = await prisma.finMappingPreset.findMany({ where: { spaceId: SPACE_ID } })
    expect(presets).toHaveLength(1)
    presetId = presets[0]!.id
    expect(descriptionHeaders(presets[0]!.mapping).sort()).toEqual(['내용', '적요'])
  }, 60000)

  test('2) 파일명이 달라도 같은 형식이면 같은 규칙이 매칭된다', async () => {
    const res = await call(importPreview(previewRequest(bankCsv(2), 'export (3) 최종_final.csv')))
    const body = await res.json()
    expect(body.matchedPreset?.id).toBe(presetId)
    expect(descriptionHeaders(body.matchedPreset?.mapping).sort()).toEqual(['내용', '적요'])
  }, 60000)

  test('3) 적요 제거 후 등록 → 같은 규칙이 갱신되고 규칙이 늘지 않는다', async () => {
    const res = await call(
      commitStaging(
        commitRequest(bankCsv(3), '완전히_다른_파일이름.csv', {
          accountId,
          kind: 'BANK',
          mapping: JSON.stringify(WITHOUT_JEOKYO),
          institution: '기업은행',
          savePreset: 'true',
          presetName: '기업은행',
        })
      )
    )
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.presetSaved).toBe(true)

    const presets = await prisma.finMappingPreset.findMany({ where: { spaceId: SPACE_ID } })
    expect(presets).toHaveLength(1) // 신규 생성 없음
    expect(presets[0]!.id).toBe(presetId)
    expect(descriptionHeaders(presets[0]!.mapping)).toEqual(['내용'])
  }, 60000)

  test('4) 다음 업로드에 적요가 되살아나지 않는다', async () => {
    const res = await call(importPreview(previewRequest(bankCsv(4), '또다른이름.csv')))
    const body = await res.json()
    expect(body.matchedPreset?.id).toBe(presetId)
    expect(descriptionHeaders(body.matchedPreset?.mapping)).toEqual(['내용'])
  }, 60000)

  test('5) 규칙 이름 변경(PATCH) — 형식 매칭은 그대로', async () => {
    const req = new NextRequest(`http://localhost/api/finance/mapping-presets/${presetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '기업은행 사업용' }),
    })
    const res = await call(presetPatch(req, { params: Promise.resolve({ id: presetId }) }))
    expect(res.status).toBe(200)

    const listRes = await call(presetsGet())
    const list = await listRes.json()
    expect(list.presets.find((p: { id: string }) => p.id === presetId)?.name).toBe('기업은행 사업용')

    const preview = await call(importPreview(previewRequest(bankCsv(5), 'x.csv')))
    const body = await preview.json()
    expect(body.matchedPreset?.name).toBe('기업은행 사업용')
  }, 60000)

  test('6) 규칙 삭제(DELETE) → 자동 매핑으로 폴백', async () => {
    const req = new NextRequest(`http://localhost/api/finance/mapping-presets/${presetId}`, {
      method: 'DELETE',
    })
    const res = await call(presetDelete(req, { params: Promise.resolve({ id: presetId }) }))
    expect(res.status).toBe(200)

    const preview = await call(importPreview(previewRequest(bankCsv(6), 'y.csv')))
    const body = await preview.json()
    expect(body.matchedPreset).toBeNull()
    // 자동 매핑은 필드당 헤더 1개만 바인딩 — 다중 적요는 규칙에서만 나온다
    expect(descriptionHeaders(body.suggestedMapping)).toEqual(['적요'])
  }, 60000)

  // detectKind 휴리스틱이 빗나가는 카드 형식 — 저장(CARD 계좌) 종류와 미리보기 판별(BANK)이
  // 어긋나도 규칙이 사각지대로 사라지거나 중복 생성되면 안 된다.
  test('7) 카드 형식: detectKind가 BANK로 오판해도 저장한 규칙이 다시 매칭된다', async () => {
    const card = await prisma.finAccount.create({
      data: { spaceId: SPACE_ID, name: '하나카드 테스트', kind: 'CARD', institution: '하나카드' },
      select: { id: true },
    })

    const detect = await call(importPreview(previewRequest(cardishCsv(1), '카드내역.csv')))
    const detectBody = await detect.json()
    expect(detectBody.kind).toBe('BANK') // 시그널 1개 → 오판(전제 확인)

    const commit = await call(
      commitStaging(
        commitRequest(cardishCsv(1), '카드내역.csv', {
          accountId: card.id,
          kind: 'CARD',
          mapping: JSON.stringify(CARDISH_MAPPING),
          institution: '하나카드',
          savePreset: 'true',
          presetName: '하나카드',
        })
      )
    )
    expect(commit.status).toBe(201)
    expect((await commit.json()).presetSaved).toBe(true)

    const again = await call(importPreview(previewRequest(cardishCsv(2), '전혀_다른_이름.csv')))
    const againBody = await again.json()
    expect(againBody.matchedPreset?.name).toBe('하나카드')
    expect(againBody.matchedPreset?.kind).toBe('CARD')

    // 같은 형식 재등록 → 갱신(중복 생성 없음)
    await call(
      commitStaging(
        commitRequest(cardishCsv(3), '또_다른_이름.csv', {
          accountId: card.id,
          kind: 'CARD',
          mapping: JSON.stringify(CARDISH_MAPPING),
          institution: '하나카드',
          savePreset: 'true',
          presetName: '하나카드',
        })
      )
    )
    const cardPresets = await prisma.finMappingPreset.findMany({
      where: { spaceId: SPACE_ID, kind: 'CARD' },
    })
    expect(cardPresets).toHaveLength(1)
  }, 60000)
})
