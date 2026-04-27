// Phase 2 Unit 16 — 콘텐츠 버전 롤백
// POST /api/sc/contents/[id]/versions/[versionId]/rollback

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { rollbackContent } from '@/lib/sc/content-versions'

type Params = { params: Promise<{ id: string; versionId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id, versionId } = await params

  // Content 소유권 + 상태 검증
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  // PUBLISHED/ANALYZED 상태에서는 롤백도 금지 (PATCH와 동일 정책)
  if (content.status === 'PUBLISHED' || content.status === 'ANALYZED') {
    return errorResponse('배포 이후에는 직접 수정할 수 없습니다', 409)
  }

  // versionId 가 이 content 에 속하는지 확인
  const version = await prisma.contentVersion.findFirst({
    where: { id: versionId, contentId: id },
    select: { id: true },
  })
  if (!version) return errorResponse('버전을 찾을 수 없습니다', 404)

  const result = await rollbackContent({
    contentId: id,
    versionId,
    userId: resolved.user?.id,
  })

  return NextResponse.json(result)
}
