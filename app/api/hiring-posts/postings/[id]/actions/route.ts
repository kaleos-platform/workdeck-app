import { withUnpublishedPosting } from '@/lib/hiring/unpublished-posting'
import {
  isPostingRecruitmentLocked,
  PUBLISHED_POSTING_LOCK_MESSAGE,
} from '@/lib/hiring/publication-policy'
import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { postingActionSchema } from '@/lib/validations/hiring-posts'
import { checkPublishable } from '@/lib/hiring/postings'

type Params = { params: Promise<{ id: string }> }

// 공고 상태 전이: publish(발행) / close(마감) / reopen(재개) / extend(마감일 연장)
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, publishedAt: true, closingDate: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = postingActionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const now = new Date()
  switch (parsed.data.action) {
    case 'publish': {
      if (isPostingRecruitmentLocked(posting))
        return errorResponse(PUBLISHED_POSTING_LOCK_MESSAGE, 409)
      return withUnpublishedPosting(resolved.space.id, id, async (tx) => {
        const current = await tx.hiringPosting.findUniqueOrThrow({
          where: { id },
          select: { closingDate: true },
        })

        const closingDate =
          parsed.data.closingDate === undefined
            ? current.closingDate
            : parsed.data.closingDate === null
              ? null
              : new Date(parsed.data.closingDate)
        // 마감일이 지난 공고는 발행(재발행) 불가 — reopen 과 동일 규칙 적용
        if (isHiringDeadlinePassed(closingDate, now)) {
          return errorResponse('마감일이 지나 발행할 수 없습니다', 400)
        }
        const check = await checkPublishable(resolved.space.id, id, tx)
        if (!check.ok)
          return errorResponse('발행 요건을 충족하지 않았습니다', 400, { errors: check.errors })
        const updated = await tx.hiringPosting.update({
          where: { id },
          data: { status: 'ACTIVE', publishedAt: posting.publishedAt ?? now, closingDate },
          select: { id: true, uuid: true, status: true, publishedAt: true, closingDate: true },
        })
        return NextResponse.json({ posting: updated })
      })
    }
    case 'close': {
      const [updated] = await prisma.hiringPosting.updateManyAndReturn({
        where: {
          id,
          spaceId: resolved.space.id,
          OR: [{ status: { not: 'DRAFT' } }, { publishedAt: { not: null } }],
        },
        data: { status: 'CLOSED' },
        select: { id: true, status: true },
      })
      if (!updated) return errorResponse('발행 이력이 없는 초안은 마감할 수 없습니다', 409)
      return NextResponse.json({ posting: updated })
    }
    case 'reopen': {
      return errorResponse('새로운 모집은 공고를 복사해 진행해 주세요.', 409)
    }
    case 'extend': {
      // 발행 잠금 예외: 모집 조건·지원서는 그대로 두고 마감일만 늦춘다(앞당기기·상시 모집 전환 불가).
      // 마감됐던 공고는 다시 접수 상태(ACTIVE)가 된다. 지원 접수 범위를 넓히기만 하므로 지원자 이력에 영향이 없다.
      if (!parsed.data.closingDate) return errorResponse('연장할 마감일을 입력하세요', 400)
      const closingDate = new Date(parsed.data.closingDate)
      if (isHiringDeadlinePassed(closingDate, now))
        return errorResponse('오늘 이후 날짜로 연장해 주세요', 400)
      // 조건부 갱신 — 발행 이력이 있고 보관되지 않았으며 기존 마감일보다 늦을 때만 반영한다.
      const [updated] = await prisma.hiringPosting.updateManyAndReturn({
        where: {
          id,
          spaceId: resolved.space.id,
          publishedAt: { not: null },
          status: { in: ['ACTIVE', 'CLOSED'] },
          closingDate: { lt: closingDate },
        },
        data: { closingDate, status: 'ACTIVE' },
        select: { id: true, status: true, closingDate: true },
      })
      if (!updated)
        return errorResponse(
          '발행된 공고의 마감일을 기존보다 늦은 날짜로만 연장할 수 있습니다',
          409
        )
      return NextResponse.json({ posting: updated })
    }
  }
}
