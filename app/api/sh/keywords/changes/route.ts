import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { keywordChangeLogCreateSchema } from '@/lib/sh/schemas'
import { diffKeywordChange, toKeywordList } from '@/lib/sh/keyword-change'

/**
 * 상품명·검색어 변경 이력 목록(GET) / 기록 생성(POST) — §26.
 *
 * append-only 다. 수정·삭제 엔드포인트를 두지 않는다 — 이력을 고칠 수 있으면
 * "어떤 변경이 성과에 영향을 줬는가"를 사후에 판단할 근거가 사라진다.
 */

const changeLogSelect = {
  id: true,
  listingId: true,
  productId: true,
  beforeName: true,
  afterName: true,
  beforeKeywords: true,
  afterKeywords: true,
  reason: true,
  reasonNote: true,
  observeMetric: true,
  multiChange: true,
  actorUserId: true,
  createdAt: true,
} satisfies Prisma.KeywordChangeLogSelect

type ChangeLogRow = Prisma.KeywordChangeLogGetPayload<{ select: typeof changeLogSelect }>

function serializeChangeLog(row: ChangeLogRow) {
  return {
    ...row,
    // Json 컬럼이라 읽을 때 JsonValue 다 — 클라이언트에는 항상 string[] 로 내보낸다.
    beforeKeywords: toKeywordList(row.beforeKeywords),
    afterKeywords: toKeywordList(row.afterKeywords),
    createdAt: row.createdAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const listingId = searchParams.get('listingId')?.trim() || null
  const productId = searchParams.get('productId')?.trim() || null
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50)))

  const where: Prisma.KeywordChangeLogWhereInput = { spaceId: resolved.space.id }
  if (listingId) where.listingId = listingId
  if (productId) where.productId = productId

  const [rows, total] = await Promise.all([
    prisma.keywordChangeLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: changeLogSelect,
    }),
    prisma.keywordChangeLog.count({ where }),
  ])

  return NextResponse.json({ data: rows.map(serializeChangeLog), total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = keywordChangeLogCreateSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 대상 소속 검증 — id 만으로 찾으면 다른 space 의 리스팅/상품에 이력을 붙일 수 있다.
  if (input.listingId) {
    const listing = await prisma.productListing.findFirst({
      where: { id: input.listingId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)
  }
  if (input.productId) {
    const product = await prisma.invProduct.findFirst({
      where: { id: input.productId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
  }

  // multiChange 는 클라이언트 입력을 쓰지 않는다 — before/after 로 결정론적으로 계산한다.
  const diff = diffKeywordChange({
    beforeName: input.beforeName,
    afterName: input.afterName,
    beforeKeywords: input.beforeKeywords,
    afterKeywords: input.afterKeywords,
  })

  const created = await prisma.keywordChangeLog.create({
    data: {
      spaceId: resolved.space.id,
      listingId: input.listingId ?? null,
      productId: input.productId ?? null,
      beforeName: input.beforeName ?? null,
      afterName: input.afterName ?? null,
      beforeKeywords: toKeywordList(input.beforeKeywords),
      afterKeywords: toKeywordList(input.afterKeywords),
      reason: input.reason,
      reasonNote: input.reasonNote ?? null,
      observeMetric: input.observeMetric ?? null,
      multiChange: diff.multiChange,
      actorUserId: resolved.user.id,
    },
    select: changeLogSelect,
  })

  return NextResponse.json({ change: serializeChangeLog(created) }, { status: 201 })
}
