/** @jest-environment node */
// 모집 관리 MCP 도구 — 지원자 개인정보가 어떤 응답에도 나오지 않음을 응답 스키마(strict)로 보장한다.
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringPosting: { findMany: jest.fn(), findFirst: jest.fn() },
    hiringApplication: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/mcp/context', () => ({ requireDeck: jest.fn() }))
jest.mock('@/lib/agent/actions/create', () => ({
  createPendingAction: jest.fn(async () => ({ status: 'pending_approval', actionId: 'a1' })),
}))

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { createPendingAction } from '@/lib/agent/actions/create'
import { recruitingTools } from '../recruiting-tools'
import type { McpToolContext } from '../types'

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>
const tool = (n: string) => recruitingTools.find((t) => t.name === n)!
const ctx: McpToolContext = {
  spaceId: 'sp-1',
  actor: { type: 'agent', id: 'ag-1' },
  scopes: ['hiring:read', 'hiring:write'],
  workId: 'wk_1',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}

// DB 가 개인정보 컬럼까지 돌려줘도(과조회 회귀) 응답에 새지 않아야 한다
const PII = {
  nameEnc: 'ENC-NAME',
  maskedName: '홍*동',
  phoneEnc: 'ENC-PHONE',
  emailEnc: 'ENC-EMAIL',
  addressEnc: 'ENC-ADDR',
  applicationEntries: [{ key: 'custom_1', value: '지원 동기 답변' }],
  memo: '내부 메모',
  managerNameEnc: 'ENC-MANAGER',
}
const PII_COLUMNS =
  /nameEnc|phoneEnc|emailEnc|addressEnc|maskedName|nameHash|phoneHash|emailHash|memo|files|comments|managerName|managerPhone/

const iso = z.string().nullable()
const listSchema = z
  .object({
    postings: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
          closingDate: iso,
          publishedAt: iso,
          createdAt: iso,
          applicationCount: z.number(),
          publicUrl: z.string().nullable(),
          editUrl: z.string(),
        })
        .strict()
    ),
  })
  .strict()
const positionSchema = z
  .object({
    name: z.string(),
    jobType: z.string().nullable(),
    payFrequency: z.string().nullable(),
    payAmount: z.number().nullable(),
    workDays: z.array(z.number()).nullable(),
    workStartAt: z.string().nullable(),
    workEndAt: z.string().nullable(),
    headcount: z.number().nullable(),
    experience: z.string().nullable(),
    education: z.string().nullable(),
    jobDescription: z.string().nullable(),
    requiredQualifications: z.string().nullable(),
    preferredQualifications: z.string().nullable(),
  })
  .strict()
const postingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    editable: z.boolean(),
    closingDate: iso,
    publishedAt: iso,
    positions: z.array(positionSchema),
    stores: z.array(z.string()),
    formFields: z
      .array(z.object({ label: z.string(), type: z.string(), required: z.boolean() }).strict())
      .default([]),
  })
  .strict()
const statsSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    total: z.number(),
    byStage: z.record(z.string(), z.number()),
    byHiringStage: z.record(z.string(), z.number()),
    daily: z.array(z.object({ date: z.string(), count: z.number() }).strict()),
    postings: z.array(
      z.object({ postingId: z.string(), title: z.string().nullable(), count: z.number() }).strict()
    ),
  })
  .strict()

function expectNoPii(result: unknown) {
  const json = JSON.stringify(result)
  for (const v of ['ENC-', '홍*동', '지원 동기 답변', '내부 메모']) expect(json).not.toContain(v)
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireDeck as jest.Mock).mockResolvedValue(undefined)
})

it('모든 도구가 recruiting 카드 활성 여부를 먼저 확인한다', async () => {
  ;(requireDeck as jest.Mock).mockRejectedValue(
    new Error('recruiting 카드가 활성화되지 않았습니다')
  )
  for (const t of recruitingTools) {
    await expect(t.execute(ctx, { postingId: 'p1', title: 't' })).rejects.toThrow('활성화되지')
  }
})

it('도구 이름은 hiring_ 접두, 설명은 한국어, scope 는 hiring:*', () => {
  for (const t of recruitingTools) {
    expect(t.name).toMatch(/^hiring_/)
    expect(t.description).toMatch(/[가-힣]/)
    expect(t.scope).toBe(t.mode === 'write' ? 'hiring:write' : 'hiring:read')
  }
})

it('hiring_list_postings: 응답 스키마에 개인정보 필드가 없다', async () => {
  db.hiringPosting.findMany.mockResolvedValue([
    {
      id: 'p1',
      uuid: 'u1',
      title: '홀 매니저',
      status: 'ACTIVE',
      closingDate: null,
      publishedAt: new Date('2026-11-01T00:00:00Z'),
      createdAt: new Date('2026-10-30T00:00:00Z'),
      _count: { applications: 3 },
      ...PII,
    },
  ])
  const r = await tool('hiring_list_postings').execute(ctx, { status: 'ACTIVE' })
  listSchema.parse(r)
  expectNoPii(r)
  const args = db.hiringPosting.findMany.mock.calls[0][0]
  expect(args.where).toEqual({ spaceId: 'sp-1', status: 'ACTIVE' })
  expect(JSON.stringify(args.select)).not.toMatch(PII_COLUMNS)
})

it('hiring_get_posting: 모집 조건·지원서 항목 라벨만, 담당자 연락처 없음', async () => {
  db.hiringPosting.findFirst.mockResolvedValue({
    id: 'p1',
    title: '홀 매니저',
    status: 'DRAFT',
    closingDate: null,
    publishedAt: null,
    ...PII,
    applicationEntries: [{ key: 'name', type: 'string', label: '이름', required: true }],
    positions: [
      {
        id: 'pp1',
        spaceId: 'sp-1',
        name: '홀',
        jobType: 'PART_TIME',
        payFrequency: 'HOURLY',
        payAmount: 11000,
        workDays: [6, 0],
        workStartAt: '10:00',
        workEndAt: '18:00',
        headcount: 2,
        experience: null,
        education: null,
        jobDescription: '서빙',
        requiredQualifications: null,
        preferredQualifications: null,
      },
    ],
    stores: [{ store: { name: '강남점' } }],
  })
  const r = await tool('hiring_get_posting').execute(ctx, { postingId: 'p1' })
  postingSchema.parse(r)
  expectNoPii(r)
  expect(db.hiringPosting.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', spaceId: 'sp-1' })
  expect(JSON.stringify(db.hiringPosting.findFirst.mock.calls[0][0].select)).not.toMatch(
    PII_COLUMNS
  )
})

it('hiring_get_posting: 다른 Space 공고는 찾을 수 없다', async () => {
  db.hiringPosting.findFirst.mockResolvedValue(null)
  await expect(tool('hiring_get_posting').execute(ctx, { postingId: 'x' })).rejects.toThrow(
    '공고를 찾을 수 없습니다'
  )
})

it('hiring_get_application_stats: 집계 컬럼만 조회하고 건수만 돌려준다', async () => {
  db.hiringPosting.findFirst.mockResolvedValue({ id: 'p1' })
  db.hiringApplication.findMany.mockResolvedValue([
    {
      createdAt: new Date('2026-11-11T16:00:00Z'), // KST 11-12 01:00
      postingId: 'p1',
      stage: 'HIRING',
      hiringStage: 'APPLIED',
      ...PII,
    },
    {
      createdAt: new Date('2026-11-12T03:00:00Z'),
      postingId: 'p1',
      stage: 'ACCEPTED',
      hiringStage: 'INTERVIEW',
      ...PII,
    },
  ])
  db.hiringPosting.findMany.mockResolvedValue([{ id: 'p1', title: '홀 매니저' }])
  const r = await tool('hiring_get_application_stats').execute(ctx, { postingId: 'p1', days: 7 })
  const stats = statsSchema.parse(r)
  expectNoPii(r)
  expect(stats.total).toBe(2)
  expect(stats.byStage).toEqual({ HIRING: 1, ACCEPTED: 1 })
  expect(stats.byHiringStage).toEqual({ APPLIED: 1, INTERVIEW: 1 })
  expect(stats.daily).toEqual([{ date: '2026-11-12', count: 2 }])
  expect(stats.postings).toEqual([{ postingId: 'p1', title: '홀 매니저', count: 2 }])
  const args = db.hiringApplication.findMany.mock.calls[0][0]
  expect(Object.keys(args.select).sort()).toEqual([
    'createdAt',
    'hiringStage',
    'postingId',
    'stage',
  ])
  expect(args.where).toMatchObject({ spaceId: 'sp-1', deletedAt: null, postingId: 'p1' })
})

it('hiring_propose_posting_draft: 즉시 만들지 않고 승인 큐에 올린다', async () => {
  const r = await tool('hiring_propose_posting_draft').execute(ctx, {
    title: '주말 홀 매니저',
    closingDate: null,
    positions: [{ name: '홀', jobType: 'PART_TIME', payFrequency: 'HOURLY', payAmount: 11000 }],
  })
  expect(r).toMatchObject({ status: 'pending_approval' })
  const draft = (createPendingAction as jest.Mock).mock.calls[0][0]
  expect(draft).toMatchObject({
    spaceId: 'sp-1',
    actionType: 'recruiting.posting.create_draft',
    source: 'MCP',
    params: { title: '주말 홀 매니저', closingDate: null },
  })
  expect(db.hiringPosting.findMany).not.toHaveBeenCalled()
})

it('hiring_propose_posting_update: 바꿀 항목이 없으면 거부', async () => {
  await expect(
    tool('hiring_propose_posting_update').execute(ctx, { postingId: 'p1' })
  ).rejects.toThrow('하나 이상')
  expect(createPendingAction).not.toHaveBeenCalled()
})

it('잘못된 마감일 형식은 제안하지 않는다', async () => {
  await expect(
    tool('hiring_propose_posting_draft').execute(ctx, { title: 't', closingDate: '12/31' })
  ).rejects.toThrow('YYYY-MM-DD')
})
