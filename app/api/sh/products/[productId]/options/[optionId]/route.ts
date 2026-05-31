import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productOptionSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const option = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
  })
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  // totalStock 집계
  const stockAgg = await prisma.invStockLevel.aggregate({
    where: { optionId },
    _sum: { quantity: true },
  })

  return NextResponse.json({ option: { ...option, totalStock: stockAgg._sum.quantity ?? 0 } })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  // 옵션이 해당 상품에 속하는지 확인
  const existing = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
    select: { id: true },
  })
  if (!existing) return errorResponse('옵션을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productOptionSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { name, sku, costPrice, retailPrice, sizeLabel, setSizeLabel, attributeValues } =
    parsed.data

  const option = await prisma.invProductOption.update({
    where: { id: optionId },
    data: {
      ...(name !== undefined && { name }),
      ...(sku !== undefined && { sku: sku ?? null }),
      ...(costPrice !== undefined && { costPrice: costPrice ?? null }),
      ...(retailPrice !== undefined && { retailPrice: retailPrice ?? null }),
      ...(sizeLabel !== undefined && { sizeLabel: sizeLabel ?? null }),
      ...(setSizeLabel !== undefined && { setSizeLabel: setSizeLabel ?? null }),
      ...(attributeValues !== undefined && { attributeValues }),
    },
  })

  return NextResponse.json({ option })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string; optionId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, optionId } = await params

  // 상품이 이 Space에 속하는지 확인
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  // 옵션이 해당 상품에 속하는지 확인
  const existing = await prisma.invProductOption.findFirst({
    where: { id: optionId, productId },
    select: { id: true },
  })
  if (!existing) return errorResponse('옵션을 찾을 수 없습니다', 404)

  // 삭제 차단 테이블 존재 여부 병렬 확인 (Restrict FK 관계)
  // reorderAccuracy는 reorderItem 없이 잔존할 수 있으므로(plan CONSUMED 후 item 편집 등)
  // 별도로 확인해야 한다. 누락 시 하드삭제 경로로 빠져 FK Restrict 위반 → 500.
  const [runItem, scenarioItem, listingItem, fulfillment, reorderItem, reorderAccuracy] =
    await Promise.all([
      prisma.productionRunItem.findFirst({ where: { optionId }, select: { id: true } }),
      prisma.pricingScenarioItem.findFirst({ where: { optionId }, select: { id: true } }),
      prisma.productListingItem.findFirst({ where: { optionId }, select: { id: true } }),
      prisma.delOrderItemFulfillment.findFirst({ where: { optionId }, select: { id: true } }),
      prisma.reorderPlanItem.findFirst({ where: { optionId }, select: { id: true } }),
      prisma.reorderPlanAccuracy.findFirst({ where: { optionId }, select: { id: true } }),
    ])

  const blockers: string[] = []
  if (runItem) blockers.push('생산 차수')
  if (scenarioItem) blockers.push('가격 시뮬레이션')
  if (listingItem) blockers.push('판매채널 상품 구성')
  if (fulfillment) blockers.push('배송주문 이행 기록')
  if (reorderItem || reorderAccuracy) blockers.push('발주 계획')

  if (blockers.length > 0) {
    // 생산 차수·발주 등 연결 기록이 있는 옵션은 완전삭제 시 FK Restrict로 막힌다.
    // 대신 소프트삭제(deletedAt) 처리하여 연결 기록에는 옵션 값이 계속 표시되도록 보존한다.
    // 목록/피커는 deletedAt: null 필터로 이 옵션을 제외한다.
    await prisma.invProductOption.update({
      where: { id: optionId },
      data: { deletedAt: new Date() },
    })
    return NextResponse.json({ ok: true, softDeleted: true })
  }

  // 연결 기록 없음 — 완전삭제 (ChannelProductAliasFulfillment 먼저 삭제)
  await prisma.$transaction([
    prisma.channelProductAliasFulfillment.deleteMany({ where: { optionId } }),
    prisma.invProductOption.delete({ where: { id: optionId } }),
  ])

  return new NextResponse(null, { status: 204 })
}
