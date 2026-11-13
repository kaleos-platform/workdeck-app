import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { createPendingAction } from '@/lib/agent/actions/create'
import { postingDraftParams, postingUpdateParams } from '@/lib/agent/actions/recruiting'
import { buildAppUrl } from '@/lib/domain'
import { getHiringPublicPostingPath, RECRUITING_BASE_PATH } from '@/lib/deck-routes'
import { parseApplicationEntriesSchema } from '@/lib/validations/hiring-applicants'
import { idempotencyKeyFor } from './write-tools'
import { ToolUserError } from './errors'
import type { ToolDefinition } from './types'

/**
 * 모집 관리(recruiting) MCP 도구.
 * ⚠️ 지원자 개인정보(이름·연락처·이메일·주소·답변·첨부·메모)는 어떤 도구로도 내보내지 않는다.
 *    지원서는 건수 집계에 필요한 컬럼(createdAt·postingId·stage·hiringStage)만 조회하고,
 *    응답은 DB 행을 펼치지 않고 필드를 하나씩 골라 만든다(recruiting-tools.test.ts 가 스키마로 강제).
 */

const DECK = 'recruiting'
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'] as const

const iso = (d: Date | null) => d?.toISOString() ?? null
const kstDate = (d: Date) => new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)

async function findPosting(spaceId: string, postingId: string) {
  const posting = await prisma.hiringPosting.findFirst({
    where: { id: postingId, spaceId },
    select: { id: true },
  })
  if (!posting) throw new ToolUserError('공고를 찾을 수 없습니다(hiring_list_postings 로 확인)')
}

const listPostings: ToolDefinition = {
  name: 'hiring_list_postings',
  description:
    '채용 공고 목록을 반환합니다(제목·상태·마감일·발행일·지원자 수·공개 URL·편집 URL). status 로 DRAFT(작성 중)/ACTIVE(발행됨)/CLOSED(마감)/ARCHIVED(보관)를 거를 수 있습니다. 최신 작성순 최대 200개. 지원자 개인정보는 제공하지 않습니다.',
  inputSchema: { status: z.enum(STATUSES).optional() },
  mode: 'read',
  scope: 'hiring:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const status = params.status as (typeof STATUSES)[number] | undefined
    const rows = await prisma.hiringPosting.findMany({
      where: { spaceId: ctx.spaceId, ...(status && { status }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        uuid: true,
        title: true,
        status: true,
        closingDate: true,
        publishedAt: true,
        createdAt: true,
        _count: { select: { applications: { where: { deletedAt: null } } } },
      },
    })
    return {
      postings: rows.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        closingDate: iso(p.closingDate),
        publishedAt: iso(p.publishedAt),
        createdAt: iso(p.createdAt),
        applicationCount: p._count.applications,
        publicUrl: p.status === 'DRAFT' ? null : buildAppUrl(getHiringPublicPostingPath(p.uuid)),
        editUrl: buildAppUrl(`${RECRUITING_BASE_PATH}/postings/${p.id}/build`),
      })),
    }
  },
}

const getPosting: ToolDefinition = {
  name: 'hiring_get_posting',
  description:
    '공고 하나의 모집 조건을 반환합니다: 제목·상태·마감일, 모집 직무별 근무 조건(고용 형태·급여·근무 요일/시간·인원·경력·학력·담당 업무·자격 요건), 모집 장소 이름, 지원서 항목(라벨·형식·필수 여부). 공고 수정 제안(hiring_propose_posting_update) 전에 현재 값을 확인할 때 쓰세요.',
  inputSchema: { postingId: z.string() },
  mode: 'read',
  scope: 'hiring:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const posting = await prisma.hiringPosting.findFirst({
      where: { id: params.postingId as string, spaceId: ctx.spaceId },
      select: {
        id: true,
        title: true,
        status: true,
        closingDate: true,
        publishedAt: true,
        applicationEntries: true,
        positions: { where: { spaceId: ctx.spaceId }, orderBy: { createdAt: 'asc' } },
        stores: {
          where: { store: { spaceId: ctx.spaceId } },
          select: { store: { select: { name: true } } },
        },
      },
    })
    if (!posting) throw new ToolUserError('공고를 찾을 수 없습니다(hiring_list_postings 로 확인)')
    return {
      id: posting.id,
      title: posting.title,
      status: posting.status,
      editable: posting.status === 'DRAFT' && !posting.publishedAt,
      closingDate: iso(posting.closingDate),
      publishedAt: iso(posting.publishedAt),
      positions: posting.positions.map((p) => ({
        name: p.name,
        jobType: p.jobType,
        payFrequency: p.payFrequency,
        payAmount: p.payAmount,
        workDays: Array.isArray(p.workDays) ? (p.workDays as number[]) : null,
        workStartAt: p.workStartAt,
        workEndAt: p.workEndAt,
        headcount: p.headcount,
        experience: p.experience,
        education: p.education,
        jobDescription: p.jobDescription,
        requiredQualifications: p.requiredQualifications,
        preferredQualifications: p.preferredQualifications,
      })),
      stores: posting.stores.map((s) => s.store.name),
      formFields: parseApplicationEntriesSchema(posting.applicationEntries).map((f) => ({
        label: f.label,
        type: f.type,
        required: !!f.required,
      })),
    }
  },
}

const getApplicationStats: ToolDefinition = {
  name: 'hiring_get_application_stats',
  description:
    '지원 현황 집계를 반환합니다: 기간 내 지원 건수, 진행 상태별(HIRING 진행 중/ACCEPTED 합격/REJECTED 불합격)·채용 단계별(APPLIED 서류/INTERVIEW 면접/JOB_OFFER 처우 협의) 인원, 일자별(KST) 추이, 공고별 건수. postingId 를 주면 그 공고만, days 는 최근 N일(기본 30, 최대 180). 지원자 개인정보는 제공하지 않습니다.',
  inputSchema: {
    postingId: z.string().optional(),
    days: z.number().int().min(1).max(180).optional(),
  },
  mode: 'read',
  scope: 'hiring:read',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const postingId = params.postingId as string | undefined
    if (postingId) await findPosting(ctx.spaceId, postingId)
    const days = (params.days as number | undefined) ?? 30
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    // 집계 컬럼만 — 개인정보 컬럼은 select 하지 않는다
    const rows = await prisma.hiringApplication.findMany({
      where: {
        spaceId: ctx.spaceId,
        deletedAt: null,
        createdAt: { gte: from },
        ...(postingId && { postingId }),
      },
      select: { createdAt: true, postingId: true, stage: true, hiringStage: true },
      take: 50_000,
    })
    const byStage: Record<string, number> = {}
    const byHiringStage: Record<string, number> = {}
    const daily = new Map<string, number>()
    const perPosting = new Map<string, number>()
    for (const r of rows) {
      byStage[r.stage] = (byStage[r.stage] ?? 0) + 1
      byHiringStage[r.hiringStage] = (byHiringStage[r.hiringStage] ?? 0) + 1
      const d = kstDate(r.createdAt)
      daily.set(d, (daily.get(d) ?? 0) + 1)
      perPosting.set(r.postingId, (perPosting.get(r.postingId) ?? 0) + 1)
    }
    const titles = perPosting.size
      ? await prisma.hiringPosting.findMany({
          where: { spaceId: ctx.spaceId, id: { in: [...perPosting.keys()] } },
          select: { id: true, title: true },
        })
      : []
    const titleOf = new Map(titles.map((t) => [t.id, t.title]))
    return {
      from: kstDate(from),
      to: kstDate(new Date()),
      total: rows.length,
      byStage,
      byHiringStage,
      daily: [...daily.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
      postings: [...perPosting.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ postingId: id, title: titleOf.get(id) ?? null, count })),
    }
  },
}

const positionShape = {
  name: z.string().describe('직무명'),
  jobType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCER', 'INTERN']).optional(),
  payFrequency: z
    .enum(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY', 'PER_TASK', 'TBD'])
    .optional(),
  payAmount: z.number().int().optional().describe('급여(원)'),
  workDays: z.array(z.number().int().min(0).max(6)).optional().describe('0=일 … 6=토'),
  workStartAt: z.string().optional().describe('HH:mm'),
  workEndAt: z.string().optional().describe('HH:mm'),
  headcount: z.number().int().optional(),
  experience: z.string().optional(),
  education: z.string().optional(),
  jobDescription: z.string().optional().describe('담당 업무'),
  requiredQualifications: z.string().optional(),
  preferredQualifications: z.string().optional(),
}

async function propose(
  ctx: Parameters<ToolDefinition['execute']>[0],
  actionType: string,
  actionParams: unknown,
  summary: string
) {
  return createPendingAction({
    spaceId: ctx.spaceId,
    actionType,
    params: actionParams,
    summary,
    source: 'MCP',
    actor: ctx.actor,
    requesterUserId: ctx.requesterUserId,
    requesterSlackUserId: ctx.requesterSlackUserId,
    workId: ctx.workId,
    actorTokenId: ctx.actorTokenId,
    idempotencyKey: idempotencyKeyFor(actionType, ctx.spaceId, actionParams),
  })
}

function parseOrThrow<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params)
  if (!parsed.success) throw new ToolUserError(parsed.error.issues.map((i) => i.message).join(', '))
  return parsed.data
}

const proposeDraft: ToolDefinition = {
  name: 'hiring_propose_posting_draft',
  description:
    '새 채용 공고 초안(제목·마감일·모집 직무별 근무 조건)을 제안합니다. 즉시 만들어지지 않고 승인 대기에 올라가며, 관리자(ADMIN)가 승인하면 「작성 중(DRAFT)」 공고로 생성됩니다. 발행은 사람이 웹에서 합니다. closingDate 는 YYYY-MM-DD(null=상시 모집, 생략=오늘+14일).',
  inputSchema: {
    title: z.string(),
    closingDate: z.string().nullable().optional(),
    positions: z.array(z.object(positionShape)).optional(),
  },
  mode: 'write',
  scope: 'hiring:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const p = parseOrThrow(postingDraftParams, params)
    const summary = `채용 공고 초안: 「${p.title}」${p.positions?.length ? ` (직무 ${p.positions.length}개)` : ''}`
    return propose(ctx, 'recruiting.posting.create_draft', p, summary)
  },
}

const proposeUpdate: ToolDefinition = {
  name: 'hiring_propose_posting_update',
  description:
    '「작성 중(DRAFT)」이고 한 번도 발행되지 않은 공고의 제목·마감일·모집 직무 수정을 제안합니다. positions 를 주면 기존 직무 전체를 이 목록으로 바꿉니다. 승인 대기에 올라가며 관리자(ADMIN) 승인 후 반영되고, 공고는 계속 DRAFT 입니다. 발행된 적 있는 공고는 수정할 수 없으니 hiring_propose_posting_draft 로 새 초안을 제안하세요.',
  inputSchema: {
    postingId: z.string(),
    title: z.string().optional(),
    closingDate: z.string().nullable().optional(),
    positions: z.array(z.object(positionShape)).optional(),
  },
  mode: 'write',
  scope: 'hiring:write',
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    const p = parseOrThrow(postingUpdateParams, params)
    const changed = [
      p.title !== undefined && '제목',
      p.closingDate !== undefined && '마감일',
      p.positions !== undefined && `직무 ${p.positions.length}개`,
    ].filter(Boolean)
    return propose(
      ctx,
      'recruiting.posting.update_draft',
      p,
      `채용 공고 초안 수정(${changed.join('·')}) — ${p.postingId}`
    )
  },
}

export const recruitingTools: ToolDefinition[] = [
  listPostings,
  getPosting,
  getApplicationStats,
  proposeDraft,
  proposeUpdate,
]
