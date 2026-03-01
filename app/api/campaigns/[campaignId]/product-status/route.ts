import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/product-status
// 캠페인의 제거 처리된 상품 목록 반환
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  const statuses = await prisma.productStatus.findMany({
    where: { workspaceId: workspace.id, campaignId },
    select: { productName: true, optionId: true, removedAt: true },
  })

  return NextResponse.json({ items: statuses })
}

// POST /api/campaigns/[campaignId]/product-status
// body: { items: [{ productName: string, optionId?: string }][] }
// 상품을 제거 상태로 upsert
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  let body: { items?: unknown }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 형식이 올바르지 않습니다', 400)
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return errorResponse('items 배열이 필요합니다', 400)
  }

  const items = body.items.filter(
    (item): item is { productName: string; optionId?: string } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).productName === 'string'
  )

  if (items.length === 0) {
    return errorResponse('유효한 상품 항목이 없습니다', 400)
  }

  const removedAt = new Date()

  await Promise.all(
    items.map(({ productName, optionId }) => {
      const normalizedOptionId = optionId ?? ''
      return prisma.productStatus.upsert({
        where: {
          workspaceId_campaignId_productName_optionId: {
            workspaceId: workspace.id,
            campaignId,
            productName,
            optionId: normalizedOptionId,
          },
        },
        create: {
          workspaceId: workspace.id,
          campaignId,
          productName,
          optionId: normalizedOptionId,
          removedAt,
        },
        update: { removedAt },
      })
    })
  )

  return NextResponse.json({ success: true, count: items.length })
}

// DELETE /api/campaigns/[campaignId]/product-status?productName=...&optionId=...
// 상품 제거 상태 해제 (쉼표 포함 상품명 오파싱 방지를 위해 분리 파라미터 사용)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const { searchParams } = request.nextUrl

  const productName = searchParams.get('productName')
  if (!productName) {
    return errorResponse('productName 파라미터가 필요합니다', 400)
  }
  const optionId = searchParams.get('optionId') ?? ''

  const result = await prisma.productStatus.deleteMany({
    where: { workspaceId: workspace.id, campaignId, productName, optionId },
  })

  return NextResponse.json({ success: true, count: result.count })
}
