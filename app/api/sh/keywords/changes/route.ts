import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toKeywordList } from '@/lib/sh/keyword-change'

/**
 * 상품명·검색어 변경 이력 목록(GET) — §26.
 *
 * 기록은 저장 라우트(리스팅·채널상품 PATCH)가 자동으로 남긴다. 생성·수정·삭제 엔드포인트를
 * 두지 않는다 — 이력을 손으로 만들거나 고칠 수 있으면 변경 효과를 판단할 근거가 사라진다.
 */

const changeLogSelect = {
  id: true,
  listingId: true,
  channelProductId: true,
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
  const channelProductId = searchParams.get('channelProductId')?.trim() || null
  const productId = searchParams.get('productId')?.trim() || null
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? 50)))

  // 대상 조건은 OR 로 묶는다 — 그룹 소속 리스팅은 자기 이력과 그룹 이력을 함께 봐야 하고,
  // channelProductId 도입 전 채널상품 이력은 productId 로만 찾힌다.
  const targets: Prisma.KeywordChangeLogWhereInput[] = []
  if (listingId) targets.push({ listingId })
  if (channelProductId) targets.push({ channelProductId })
  if (productId) targets.push({ productId })
  const where: Prisma.KeywordChangeLogWhereInput = {
    spaceId: resolved.space.id,
    ...(targets.length > 0 && { OR: targets }),
  }

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
