import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { keywordBulkSchema } from '@/lib/sh/schemas'
import { assertLinkOwnership, createOrUpdateLink } from '@/lib/sh/keyword-link'

/**
 * 키워드 일괄 처리 — 상태 전환 / 삭제 / 상품·리스팅 연결.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = keywordBulkSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data
  const ids = Array.from(new Set(input.ids))

  // space 소속 검증 — 요청한 id 전부가 이 space 것이어야 진행한다.
  const owned = await prisma.keywordMaster.findMany({
    where: { id: { in: ids }, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (owned.length !== ids.length) {
    return errorResponse('일부 키워드를 찾을 수 없습니다', 404)
  }

  if (input.action === 'status') {
    const result = await prisma.keywordMaster.updateMany({
      where: { id: { in: ids }, spaceId: resolved.space.id },
      data: { status: input.payload.status },
    })
    return NextResponse.json({ updated: result.count })
  }

  if (input.action === 'delete') {
    const result = await prisma.keywordMaster.deleteMany({
      where: { id: { in: ids }, spaceId: resolved.space.id },
    })
    return NextResponse.json({ deleted: result.count })
  }

  // action === 'link' — 대상(상품/리스팅) 소유권은 한 번만 확인하면 된다.
  const { productId, listingId, role } = input.payload
  const ownership = await assertLinkOwnership(resolved.space.id, {
    keywordId: ids[0],
    productId,
    listingId,
  })
  if (ownership) return errorResponse(ownership.message, ownership.status)

  // createMany 를 쓰지 않는다 — null 을 포함한 조합은 unique 제약이 막아주지 못해
  // skipDuplicates 가 동작하지 않는다(keyword-link.ts 주석 참고).
  let created = 0
  for (const keywordId of ids) {
    const res = await createOrUpdateLink({ keywordId, productId, listingId }, { role })
    if (res.created) created += 1
  }

  return NextResponse.json({ linked: ids.length, created })
}
