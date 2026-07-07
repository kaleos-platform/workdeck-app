import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 채널 사용자 정의 정렬 순서 일괄 업데이트.
 * body: { orderedIds: string[] }
 */
export async function PUT(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const orderedIds = Array.isArray(body?.orderedIds)
    ? (body.orderedIds.filter((v: unknown) => typeof v === 'string') as string[])
    : null
  if (!orderedIds || orderedIds.length === 0) {
    return errorResponse('orderedIds가 필요합니다', 400)
  }

  // 대량 트랜잭션 DoS 방지 — 상한 초과 시 즉시 거부
  if (orderedIds.length > 1000) {
    return errorResponse('한 번에 최대 1000개까지 정렬할 수 있습니다', 400)
  }

  // 모든 id가 같은 space에 속하는지 검증
  const owned = await prisma.channel.findMany({
    where: { id: { in: orderedIds }, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (owned.length !== orderedIds.length) {
    return errorResponse('일부 채널을 찾을 수 없습니다', 404)
  }

  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.channel.update({
        where: { id },
        data: { sortOrder: idx },
      })
    )
  )

  return NextResponse.json({ ok: true, count: orderedIds.length })
}
