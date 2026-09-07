import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { keywordLinkCreateSchema, keywordLinkDeleteSchema } from '@/lib/sh/schemas'
import {
  assertLinkOwnership,
  createOrUpdateLink,
  linkSelect,
  normalizeLinkTarget,
} from '@/lib/sh/keyword-link'

/**
 * 키워드 ↔ 상품/판매채널 상품 연결(POST) / 해제(DELETE).
 * productId·listingId 중 최소 하나는 non-null 이어야 한다(Zod 에서 검증 — Prisma 로는
 * 표현할 수 없는 XOR 제약).
 */

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = keywordLinkCreateSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  const ownership = await assertLinkOwnership(resolved.space.id, input)
  if (ownership) return errorResponse(ownership.message, ownership.status)

  const { link, created } = await createOrUpdateLink(input, {
    role: input.role,
    sortOrder: input.sortOrder,
  })

  return NextResponse.json({ link }, { status: created ? 201 : 200 })
}

export async function DELETE(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = keywordLinkDeleteSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  if ('id' in input) {
    // link id 단건 — space 는 소속 키워드를 통해 확인한다(링크에는 spaceId 가 없다).
    const link = await prisma.keywordMasterLink.findFirst({
      where: { id: input.id, keyword: { spaceId: resolved.space.id } },
      select: { id: true },
    })
    if (!link) return errorResponse('연결을 찾을 수 없습니다', 404)
    await prisma.keywordMasterLink.delete({ where: { id: link.id } })
    return NextResponse.json({ ok: true, deleted: 1 })
  }

  const ownership = await assertLinkOwnership(resolved.space.id, input)
  if (ownership) return errorResponse(ownership.message, ownership.status)

  // 명시적 null — undefined 로 두면 "필터 없음"이 되어 다른 대상의 링크까지 지운다.
  const t = normalizeLinkTarget(input)
  const target = await prisma.keywordMasterLink.findFirst({
    where: { keywordId: t.keywordId, productId: t.productId, listingId: t.listingId },
    select: linkSelect,
  })
  if (!target) return errorResponse('연결을 찾을 수 없습니다', 404)

  await prisma.keywordMasterLink.delete({ where: { id: target.id } })
  return NextResponse.json({ ok: true, deleted: 1 })
}
