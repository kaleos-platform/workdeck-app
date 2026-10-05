import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createContentSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 공고 상세 콘텐츠 블록 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  const contents = await prisma.hiringContent.findMany({
    where: { postingId: id, sourceType: 'POSTING_DETAIL' },
    orderBy: { sortOrder: 'asc' },
  })
  return NextResponse.json({ contents })
}

// 상세 콘텐츠 블록 추가
// body: { contentType: 'image'|'text', sortOrder? }
// 생성 직후 data=null; text는 PATCH로 Tiptap JSON 저장, image는 PATCH로 이미지 업로드
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = createContentSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 직무 정보 블록은 공고당 하나만 허용
  if (parsed.data.contentType === 'positions') {
    const existing = await prisma.hiringContent.findFirst({
      where: { postingId: id, sourceType: 'POSTING_DETAIL', contentType: 'positions' },
      select: { id: true },
    })
    if (existing) {
      return errorResponse('직무 정보 블록은 하나만 추가할 수 있습니다', 409)
    }
  }

  // sortOrder 미지정 시 마지막 뒤에 배치
  const last = await prisma.hiringContent.findFirst({
    where: { postingId: id, sourceType: 'POSTING_DETAIL' },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })
  const sortOrder = parsed.data.sortOrder ?? (last ? last.sortOrder + 1 : 0)

  const content = await prisma.hiringContent.create({
    data: {
      spaceId: resolved.space.id,
      postingId: id,
      sourceType: 'POSTING_DETAIL',
      contentType: parsed.data.contentType,
      sortOrder,
      data:
        parsed.data.contentType === 'button' ? { title: '지원하기', linkType: 'form' } : undefined,
    },
  })
  return NextResponse.json({ content }, { status: 201 })
}

const reorderSchema = z
  .object({ contentIds: z.array(z.string().min(1)).min(1).max(1000) })
  .refine(({ contentIds }) => new Set(contentIds).size === contentIds.length)

// 전체 순서를 한 트랜잭션으로 변경해 두 카드 중 하나만 저장되는 상태를 방지한다.
export async function PUT(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id } = await params
  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = reorderSchema.safeParse(body)
  if (!parsed.success) return errorResponse('카드 순서가 올바르지 않습니다', 400)
  try {
    const saved = await prisma.$transaction(
      async (tx) => {
        const contents = await tx.hiringContent.findMany({
          where: { postingId: id, spaceId: resolved.space.id, sourceType: 'POSTING_DETAIL' },
          select: { id: true },
        })
        const ids = new Set(contents.map((c) => c.id))
        if (
          ids.size !== parsed.data.contentIds.length ||
          parsed.data.contentIds.some((cid) => !ids.has(cid))
        )
          return false
        for (const [sortOrder, contentId] of parsed.data.contentIds.entries()) {
          await tx.hiringContent.update({ where: { id: contentId }, data: { sortOrder } })
        }
        return true
      },
      { isolationLevel: 'Serializable' }
    )
    if (!saved)
      return errorResponse('카드 목록이 변경되었습니다. 새로고침 후 다시 정렬하세요.', 409)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
      return errorResponse('다른 변경과 겹쳤습니다. 새로고침 후 다시 정렬하세요.', 409)
    }
    return errorResponse('순서 변경 저장에 실패했습니다', 500)
  }
}
