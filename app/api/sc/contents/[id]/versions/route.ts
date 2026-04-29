// Phase 2 Unit 16 — 콘텐츠 버전 목록 조회
// GET /api/sc/contents/[id]/versions
// doc 본문은 제외하고 메타만 반환 (payload 경량화).

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // Content 소유권 검증 (spaceId 일치 확인)
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  const versions = await prisma.contentVersion.findMany({
    where: { contentId: id },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      versionNumber: true,
      title: true,
      createdAt: true,
      note: true,
      createdByUserId: true,
    },
  })

  return NextResponse.json({ versions })
}
