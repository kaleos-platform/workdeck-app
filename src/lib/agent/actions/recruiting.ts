import { z } from 'zod'
import type { ActionDefinition, ActionExecContext } from './types'
import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { createDraftPosting } from '@/lib/hiring/postings'
import { postingPositionSchema } from '@/lib/validations/hiring-posts'
import { buildAppUrl } from '@/lib/domain'
import { RECRUITING_BASE_PATH } from '@/lib/deck-routes'
import type { Prisma } from '@/generated/prisma/client'

// 모집 관리 공고 초안 제안 — 승인 후에만 반영되고 결과는 항상 DRAFT(발행은 사람이 웹에서).

const DECK = 'recruiting'

function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

// 직무 기준정보(positionId) 연결은 웹에서만 — 에이전트는 근무 조건 텍스트·수치만 제안한다.
const positionParams = postingPositionSchema.omit({ positionId: true })

const closingDateParam = z
  .string()
  .date('마감일은 YYYY-MM-DD 형식이어야 합니다')
  .nullable()
  .optional()
  .describe('지원 마감일 YYYY-MM-DD(KST). null 이면 상시 모집. 생략하면 초안은 오늘+14일')

export const postingDraftParams = z.object({
  title: z.string().trim().min(1).max(200),
  closingDate: closingDateParam,
  positions: z.array(positionParams).max(10).optional(),
})
export type PostingDraftParams = z.infer<typeof postingDraftParams>

export const postingUpdateParams = z
  .object({
    postingId: z.string().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    closingDate: closingDateParam,
    // 지정하면 공고의 모집 직무 전체를 이 목록으로 바꾼다
    positions: z.array(positionParams).max(10).optional(),
  })
  .refine(
    (p) => p.title !== undefined || p.closingDate !== undefined || p.positions !== undefined,
    '바꿀 항목(title·closingDate·positions)을 하나 이상 지정하세요'
  )
export type PostingUpdateParams = z.infer<typeof postingUpdateParams>

function todayKst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function parseClosingDate(value: string | null | undefined) {
  if (value === undefined || value === null) return value
  if (value < todayKst()) throw new ToolUserError('마감일은 오늘 이후여야 합니다')
  return new Date(`${value}T00:00:00Z`)
}

type PositionInput = z.infer<typeof positionParams>

async function createPositions(
  tx: Prisma.TransactionClient,
  spaceId: string,
  postingId: string,
  positions: PositionInput[]
) {
  if (!positions.length) return
  await tx.hiringPostingPosition.createMany({
    data: positions.map(({ workDays, ...rest }) => ({
      spaceId,
      postingId,
      ...(workDays ? { workDays } : {}),
      ...rest,
    })),
  })
}

function editUrl(postingId: string) {
  return buildAppUrl(`${RECRUITING_BASE_PATH}/postings/${postingId}/build`)
}

/** 수정 가능한 초안인지 — 같은 Space·DRAFT·미발행·이관 대상 아님 */
async function assertEditableDraft(spaceId: string, postingId: string) {
  const posting = await prisma.hiringPosting.findFirst({
    where: { id: postingId, spaceId },
    select: { status: true, publishedAt: true },
  })
  if (!posting) throw new ToolUserError('공고를 찾을 수 없습니다(hiring_list_postings 로 확인)')
  if (posting.status !== 'DRAFT' || posting.publishedAt)
    throw new ToolUserError(
      '발행된 적 있는 공고는 수정할 수 없습니다. hiring_propose_posting_draft 로 새 초안을 제안하세요'
    )
  // 오프닝 이관 공고는 행이 바뀌면 남은 지원서 이관이 막힌다
  const migrated = await prisma.hiringMigrationRecord.findFirst({
    where: { targetModel: 'HiringPosting', targetId: postingId },
    select: { id: true },
  })
  if (migrated) throw new ToolUserError('이전(이관) 중인 공고는 에이전트가 수정할 수 없습니다')
}

const createDraft = def<PostingDraftParams>({
  actionType: 'recruiting.posting.create_draft',
  deckKey: DECK,
  title: '채용 공고 초안 작성',
  paramsSchema: postingDraftParams,
  requiredRole: 'ADMIN',
  retryableAfterFailure: true,
  async validateCreate(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    parseClosingDate(params.closingDate)
  },
  async execute(ctx: ActionExecContext, params) {
    await requireDeck(ctx.spaceId, DECK)
    const closingDate = parseClosingDate(params.closingDate)
    const posting = await prisma.$transaction(async (tx) => {
      // 작성자 = 승인한 구성원(메일 알림 담당자가 된다)
      const created = await createDraftPosting(tx, {
        spaceId: ctx.spaceId,
        authorUserId: ctx.deciderId ?? null,
        title: params.title,
        closingDate,
      })
      await createPositions(tx, ctx.spaceId, created.id, params.positions ?? [])
      return created
    })
    return { postingId: posting.id, status: posting.status, editUrl: editUrl(posting.id) }
  },
})

const updateDraft = def<PostingUpdateParams>({
  actionType: 'recruiting.posting.update_draft',
  deckKey: DECK,
  title: '채용 공고 초안 수정',
  paramsSchema: postingUpdateParams,
  requiredRole: 'ADMIN',
  retryableAfterFailure: true,
  async validateCreate(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    parseClosingDate(params.closingDate)
    await assertEditableDraft(ctx.spaceId, params.postingId)
  },
  async snapshot(ctx, params) {
    return prisma.hiringPosting.findFirst({
      where: { id: params.postingId, spaceId: ctx.spaceId },
      select: {
        title: true,
        closingDate: true,
        positions: { where: { spaceId: ctx.spaceId }, orderBy: { createdAt: 'asc' } },
      },
    })
  },
  async execute(ctx, params) {
    await requireDeck(ctx.spaceId, DECK)
    await assertEditableDraft(ctx.spaceId, params.postingId)
    const closingDate = parseClosingDate(params.closingDate)
    await prisma.$transaction(async (tx) => {
      // 발행과 같은 행 잠금 — 승인 사이에 발행됐으면 반영하지 않는다
      const locked = await tx.hiringPosting.updateMany({
        where: { id: params.postingId, spaceId: ctx.spaceId, status: 'DRAFT', publishedAt: null },
        data: {
          ...(params.title !== undefined && { title: params.title }),
          ...(closingDate !== undefined && { closingDate }),
        },
      })
      if (locked.count !== 1) throw new ToolUserError('공고가 이미 발행되어 수정하지 않았습니다')
      if (params.positions) {
        await tx.hiringPostingPosition.deleteMany({
          where: { postingId: params.postingId, spaceId: ctx.spaceId },
        })
        await createPositions(tx, ctx.spaceId, params.postingId, params.positions)
      }
    })
    return { postingId: params.postingId, status: 'DRAFT', editUrl: editUrl(params.postingId) }
  },
})

export const recruitingActions: ActionDefinition[] = [createDraft, updateDraft]
