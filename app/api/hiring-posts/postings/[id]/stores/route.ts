import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { linkStoresSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 공고에 연결된 매장 id 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const posting = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)

  const links = await prisma.hiringPostingStore.findMany({
    where: { postingId: id },
    select: { storeId: true },
  })
  return NextResponse.json({ storeIds: links.map((l) => l.storeId) })
}

// 공고 매장 연결 전체 교체 (set semantics)
export async function PUT(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-posts')
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
  const parsed = linkStoresSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 요청된 매장이 모두 같은 space 소속인지 검증
  const validStores = await prisma.hiringStore.findMany({
    where: { id: { in: parsed.data.storeIds }, spaceId: resolved.space.id },
    select: { id: true },
  })
  const validIds = new Set(validStores.map((s) => s.id))
  const storeIds = parsed.data.storeIds.filter((sid) => validIds.has(sid))

  await prisma.$transaction([
    prisma.hiringPostingStore.deleteMany({ where: { postingId: id } }),
    prisma.hiringPostingStore.createMany({
      data: storeIds.map((storeId) => ({ postingId: id, storeId })),
      skipDuplicates: true,
    }),
  ])

  return NextResponse.json({ storeIds })
}
