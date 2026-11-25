import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { invalidateCoupangAdsCache } from '@/lib/coupang-ads/cache'
import { NEGATIVE_KEYWORD_RULES } from '@/lib/coupang-ads/negative-keyword-rules'

const MAX_KEYWORDS = 1000
const REMOVED_MEMO = '제외 키워드 화면에서 제거'
const ACTIONS = ['remove', 'undo', 'dismiss', 'undismiss'] as const
type Action = (typeof ACTIONS)[number]

// POST /api/coupang-ads/negative-keywords
// body: { action, campaignId, keywords: string[], removedAt?: ISO(undo 전용) }
// - remove: 제거 표시(이미 제거된 키워드는 최초 removedAt 유지 → 재시도로 유예 기간이 늘지 않음)
// - undo: 응답받은 removedAt 과 같은 행만 해제(그 사이 다른 사람이 다시 제거한 행은 건드리지 않음)
// - dismiss / undismiss: 「제외 안 함」 30일 숨김 / 해제
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace({ write: true })
  if ('error' in resolved) return resolved.error
  const workspaceId = resolved.workspace.id

  let body: { action?: unknown; campaignId?: unknown; keywords?: unknown; removedAt?: unknown }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 형식이 올바르지 않습니다', 400)
  }

  const action = body.action as Action
  if (!ACTIONS.includes(action)) return errorResponse('action 값이 올바르지 않습니다', 400)
  if (typeof body.campaignId !== 'string' || !body.campaignId) {
    return errorResponse('campaignId 가 필요합니다', 400)
  }
  const campaignId = body.campaignId
  if (
    !Array.isArray(body.keywords) ||
    body.keywords.length === 0 ||
    body.keywords.length > MAX_KEYWORDS ||
    !body.keywords.every((k) => typeof k === 'string' && k.length > 0)
  ) {
    return errorResponse(`keywords 는 1~${MAX_KEYWORDS}개의 문자열 배열이어야 합니다`, 400)
  }
  const keywords = [...new Set(body.keywords as string[])]

  let undoAt: Date | null = null
  if (action === 'undo') {
    undoAt = typeof body.removedAt === 'string' ? new Date(body.removedAt) : null
    if (!undoAt || Number.isNaN(undoAt.getTime())) {
      return errorResponse('removedAt 이 필요합니다', 400)
    }
  }

  const campaign = await prisma.adRecord.findFirst({
    where: { workspaceId, campaignId },
    select: { id: true },
  })
  if (!campaign) return errorResponse('캠페인을 찾을 수 없습니다', 404)

  const now = new Date()
  const where = { workspaceId, campaignId, keyword: { in: keywords } }
  const createRows = (extra: { removedAt?: Date; removedMemo?: string; dismissedUntil?: Date }) =>
    prisma.keywordStatus.createMany({
      data: keywords.map((keyword) => ({ workspaceId, campaignId, keyword, ...extra })),
      skipDuplicates: true,
    })

  let count = 0
  if (action === 'remove') {
    // 새 행은 createMany 로 now 가 들어가고, 기존 행 중 removedAt 이 없는 것만 now 로 채운다.
    await prisma.$transaction([
      createRows({ removedAt: now, removedMemo: REMOVED_MEMO }),
      prisma.keywordStatus.updateMany({
        where: { ...where, removedAt: null },
        data: { removedAt: now, removedMemo: REMOVED_MEMO },
      }),
    ])
    count = keywords.length
  } else if (action === 'undo') {
    const res = await prisma.keywordStatus.updateMany({
      where: { ...where, removedAt: undoAt! },
      data: { removedAt: null, removedMemo: null },
    })
    count = res.count
  } else if (action === 'dismiss') {
    const until = new Date(now.getTime() + NEGATIVE_KEYWORD_RULES.DISMISS_DAYS * 86_400_000)
    await prisma.$transaction([
      createRows({ dismissedUntil: until }),
      prisma.keywordStatus.updateMany({ where, data: { dismissedUntil: until } }),
    ])
    count = keywords.length
  } else {
    const res = await prisma.keywordStatus.updateMany({ where, data: { dismissedUntil: null } })
    count = res.count
  }

  invalidateCoupangAdsCache(workspaceId)

  return NextResponse.json({ success: true, count, ...(action === 'remove' && { removedAt: now }) })
}
