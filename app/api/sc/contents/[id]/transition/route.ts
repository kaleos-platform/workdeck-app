import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { contentTransitionSchema } from '@/lib/sc/schemas'
import {
  canTransition,
  countDocTextLength,
  MIN_DOC_TEXT_LENGTH_FOR_REVIEW,
  nextAllowed,
} from '@/lib/sc/content-state'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, doc: true, publishedAt: true },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = contentTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  if (!canTransition(content.status, parsed.data.to)) {
    return errorResponse(`허용되지 않는 상태 전이: ${content.status} → ${parsed.data.to}`, 400, {
      allowed: nextAllowed(content.status),
    })
  }

  // 수동 게시 대기 배포가 있으면 게시 URL 과 함께 완료 처리해야 콘텐츠·배포 상태가 어긋나지 않는다.
  if (parsed.data.to === 'PUBLISHED') {
    const waiting = await prisma.contentDeployment.count({
      where: { contentId: id, spaceId: resolved.space.id, status: { in: ['AWAITING_ASSETS', 'AWAITING_MANUAL'] } },
    })
    if (waiting > 0) {
      return errorResponse('콘텐츠 상세의 배포 카드에서 사진 등록이나 게시 완료 처리를 먼저 하세요', 409)
    }
  }

  // IN_REVIEW 전환 시 최소 본문 길이 검증.
  if (parsed.data.to === 'IN_REVIEW') {
    const length = countDocTextLength(content.doc)
    if (length < MIN_DOC_TEXT_LENGTH_FOR_REVIEW) {
      return errorResponse(
        `검토 요청에는 최소 ${MIN_DOC_TEXT_LENGTH_FOR_REVIEW}자 이상의 본문이 필요합니다`,
        400,
        { currentLength: length }
      )
    }
  }

  const updated = await prisma.content.update({
    where: { id },
    data: {
      status: parsed.data.to,
      publishedAt: parsed.data.to === 'PUBLISHED' && !content.publishedAt ? new Date() : undefined,
    },
  })
  return NextResponse.json({ content: updated })
}
