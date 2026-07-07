import { NextRequest, NextResponse } from 'next/server'
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
  const resolved = await resolveDeckContext('recruiting')
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
    },
  })
  return NextResponse.json({ content }, { status: 201 })
}
