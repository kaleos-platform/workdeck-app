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
  const resolved = await resolveDeckContext('sales-content')
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
