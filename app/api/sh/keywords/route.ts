import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { keywordMasterCreateSchema } from '@/lib/sh/schemas'
import { keywordKeys } from '@/lib/sh/keyword-normalize'
import { scoreKeyword, type KeywordScoreInputs } from '@/lib/sh/keyword-score'
import { serializeKeyword, keywordSelect } from '@/lib/sh/keyword-serialize'

/**
 * 키워드 마스터 목록(GET) / 생성(POST) — §24.
 * 키워드는 space 당 1행이고 여러 상품이 공유한다(귀속은 KeywordMasterLink).
 */

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const q = (searchParams.get('q') ?? '').trim()
  const status = searchParams.get('status')?.trim() || null
  const type = searchParams.get('type')?.trim() || null
  const source = searchParams.get('source')?.trim() || null
  const productId = searchParams.get('productId')?.trim() || null
  const listingId = searchParams.get('listingId')?.trim() || null
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50)))

  const where: Prisma.KeywordMasterWhereInput = { spaceId: resolved.space.id }
  if (q) where.keyword = { contains: q, mode: 'insensitive' }
  if (status) where.status = status as Prisma.KeywordMasterWhereInput['status']
  if (type) where.type = type as Prisma.KeywordMasterWhereInput['type']
  if (source) where.source = source as Prisma.KeywordMasterWhereInput['source']
  // 연결 필터. 두 조건이 같이 오면 각각의 링크가 모두 있어야 통과하도록 AND 로 쌓는다
  // (하나의 `links: { some: {...} }` 에 두 필드를 넣으면 "같은 링크 행"을 요구하게 되는데,
  //  productId·listingId 는 서로 다른 행에 나뉘어 있는 것이 정상이다).
  const linkFilters: Prisma.KeywordMasterWhereInput[] = []
  if (productId) linkFilters.push({ links: { some: { productId } } })
  if (listingId) linkFilters.push({ links: { some: { listingId } } })
  if (linkFilters.length > 0) where.AND = linkFilters

  const [rows, total] = await Promise.all([
    prisma.keywordMaster.findMany({
      where,
      orderBy: [{ score: 'desc' }, { keyword: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: keywordSelect,
    }),
    prisma.keywordMaster.count({ where }),
  ])

  return NextResponse.json({ data: rows.map(serializeKeyword), total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = keywordMasterCreateSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data
  const keys = keywordKeys(input.keyword)

  // score 를 명시하지 않으면 scoreInputs 로부터 파생한다(§17).
  const score =
    input.score ??
    (input.scoreInputs ? scoreKeyword(input.scoreInputs as KeywordScoreInputs).score : 0)

  // @@unique([spaceId, normalized]) 충돌은 409 + 기존 행 — 클라이언트가 "이미 있음"을
  // 새 행 생성 없이 이어받을 수 있어야 한다.
  const duplicate = await prisma.keywordMaster.findFirst({
    where: { spaceId: resolved.space.id, normalized: keys.normalized },
    select: keywordSelect,
  })
  if (duplicate) {
    return errorResponse('이미 등록된 키워드입니다', 409, { keyword: serializeKeyword(duplicate) })
  }

  try {
    const created = await prisma.keywordMaster.create({
      data: {
        spaceId: resolved.space.id,
        keyword: input.keyword,
        normalized: keys.normalized,
        despaced: keys.despaced,
        sortedKey: keys.sortedKey,
        category: input.category ?? null,
        type: input.type ?? undefined,
        source: input.source ?? undefined,
        status: input.status ?? undefined,
        score,
        scoreInputs: input.scoreInputs ?? {},
        memo: input.memo ?? null,
        researchedAt: input.researchedAt ?? null,
      },
      select: keywordSelect,
    })
    return NextResponse.json({ keyword: serializeKeyword(created) }, { status: 201 })
  } catch (e) {
    // findFirst 이후 동시 생성된 경우 — 경합에서도 409 계약을 유지한다.
    if ((e as { code?: string }).code === 'P2002') {
      const existing = await prisma.keywordMaster.findFirst({
        where: { spaceId: resolved.space.id, normalized: keys.normalized },
        select: keywordSelect,
      })
      return errorResponse('이미 등록된 키워드입니다', 409, {
        keyword: existing ? serializeKeyword(existing) : null,
      })
    }
    throw e
  }
}
