import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { postingActionSchema } from '@/lib/validations/hiring-posts'
import { checkPublishable } from '@/lib/hiring/postings'

type Params = { params: Promise<{ id: string }> }

// 공고 상태 전이: publish(발행) / close(마감) / reopen(재개) / archive(보관)
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-posts')
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
      // 마감일이 지난 공고는 발행(재발행) 불가 — reopen 과 동일 규칙 적용
      if (posting.closingDate && posting.closingDate.getTime() < now.getTime()) {
        return errorResponse('마감일이 지나 발행할 수 없습니다', 400)
      }
      const check = await checkPublishable(resolved.space.id, id)
      if (!check.ok)
        return errorResponse('발행 요건을 충족하지 않았습니다', 400, { errors: check.errors })
      const updated = await prisma.hiringPosting.update({
        where: { id },
        data: { status: 'ACTIVE', publishedAt: posting.publishedAt ?? now },
        select: { id: true, uuid: true, status: true, publishedAt: true },
      })
      return NextResponse.json({ posting: updated })
    }
    case 'close': {
      const updated = await prisma.hiringPosting.update({
        where: { id },
        data: { status: 'CLOSED' },
        select: { id: true, status: true },
      })
      return NextResponse.json({ posting: updated })
    }
    case 'reopen': {
      // 마감일이 지났으면 재개 불가
      if (posting.closingDate && posting.closingDate.getTime() < now.getTime()) {
        return errorResponse('마감일이 지나 재개할 수 없습니다', 400)
      }
      const updated = await prisma.hiringPosting.update({
        where: { id },
        data: { status: 'ACTIVE' },
        select: { id: true, status: true },
      })
      return NextResponse.json({ posting: updated })
    }
    case 'archive': {
      const updated = await prisma.hiringPosting.update({
        where: { id },
        data: { status: 'ARCHIVED' },
        select: { id: true, status: true },
      })
      return NextResponse.json({ posting: updated })
    }
  }
}
