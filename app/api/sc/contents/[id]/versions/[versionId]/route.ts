// Phase 2 Unit 16 — 콘텐츠 버전 단건 상세 조회
// GET /api/sc/contents/[id]/versions/[versionId]
// doc 본문 포함 전체 필드 반환.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string; versionId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id, versionId } = await params

  // Content 소유권 검증
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  const version = await prisma.contentVersion.findFirst({
    where: { id: versionId, contentId: id },
  })
  if (!version) return errorResponse('버전을 찾을 수 없습니다', 404)

  return NextResponse.json({ version })
}
