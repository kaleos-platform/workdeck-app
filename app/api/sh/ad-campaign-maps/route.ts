import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 광고 캠페인 ↔ 내부 상품 귀속 매핑 CRUD.
 *
 * 외부 옵션ID 브리지로 옵션 단위 귀속이 되는 광고비는 자동 처리되고, 남은 캠페인
 * 광고비를 이 매핑으로 상품에 귀속한다(margin-query.ts 2단계). 매핑이 없으면
 * 추정 배분하지 않고 unallocatedAdCost 로 남긴다.
 */

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const maps = await prisma.adCampaignProductMap.findMany({
    where: { spaceId: resolved.space.id },
    select: {
      id: true,
      campaignId: true,
      productId: true,
      memo: true,
      updatedAt: true,
      product: { select: { name: true, internalName: true } },
    },
    orderBy: [{ campaignId: 'asc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({ data: maps })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = (await req.json().catch(() => null)) as {
    campaignId?: string
    productId?: string
    memo?: string | null
  } | null

  const campaignId = body?.campaignId?.trim()
  const productId = body?.productId?.trim()
  if (!campaignId || !productId) {
    return NextResponse.json({ error: 'campaignId·productId는 필수입니다' }, { status: 400 })
  }

  // 다른 Space 상품으로의 매핑을 막는다.
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) {
    return NextResponse.json({ error: '상품을 찾을 수 없습니다' }, { status: 404 })
  }

  const saved = await prisma.adCampaignProductMap.upsert({
    where: {
      spaceId_campaignId_productId: { spaceId: resolved.space.id, campaignId, productId },
    },
    create: { spaceId: resolved.space.id, campaignId, productId, memo: body?.memo ?? null },
    update: { memo: body?.memo ?? null },
    select: { id: true, campaignId: true, productId: true, memo: true },
  })

  return NextResponse.json({ data: saved })
}

export async function DELETE(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id는 필수입니다' }, { status: 400 })

  // spaceId 조건을 함께 걸어 cross-space 삭제를 차단한다.
  const deleted = await prisma.adCampaignProductMap.deleteMany({
    where: { id, spaceId: resolved.space.id },
  })
  if (deleted.count === 0) {
    return NextResponse.json({ error: '매핑을 찾을 수 없습니다' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
