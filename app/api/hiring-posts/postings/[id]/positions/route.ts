import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { postingPositionSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 공고의 직무 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  const positions = await prisma.hiringPostingPosition.findMany({
    where: { postingId: id },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ positions })
}

// 직무 추가
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
  const parsed = postingPositionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // positionId 가 있으면 같은 space 소속인지 확인
  if (parsed.data.positionId) {
    const linked = await prisma.hiringPosition.findFirst({
      where: { id: parsed.data.positionId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!linked) return errorResponse('직무 기준정보를 찾을 수 없습니다', 404)
  }

  const { positionId, workDays, ...rest } = parsed.data
  const position = await prisma.hiringPostingPosition.create({
    data: {
      spaceId: resolved.space.id,
      postingId: id,
      ...(positionId ? { positionId } : {}),
      ...(workDays ? { workDays } : {}),
      ...rest,
    },
  })
  return NextResponse.json({ position }, { status: 201 })
}
