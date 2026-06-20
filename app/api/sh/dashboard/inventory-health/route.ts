import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productDisplayName } from '@/lib/sh/product-display'

// 홈 대시보드 "재고 조정" 카드 — 마이너스 재고 + 조정 대기.
// 마이너스 재고(수치 불일치)나 미적용 대사가 있으면 재고 조정 페이지로 유도.

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  const [negativeLevels, pendingReconciliationCount] = await Promise.all([
    // 마이너스 재고 옵션×위치 (미리보기 + 카운트)
    prisma.invStockLevel.findMany({
      where: { spaceId, quantity: { lt: 0 } },
      select: {
        quantity: true,
        option: {
          select: {
            name: true,
            product: { select: { name: true, internalName: true } },
          },
        },
        location: { select: { name: true } },
      },
      orderBy: { quantity: 'asc' }, // 가장 큰 음수 먼저
    }),
    // 미적용 대사 (PENDING/PARTIAL) — 조정 적용 대기
    prisma.invReconciliation.count({
      where: { spaceId, status: { in: ['PENDING', 'PARTIAL'] } },
    }),
  ])

  const negativeSamples = negativeLevels.slice(0, 5).map((l) => ({
    productName: productDisplayName(l.option.product),
    optionName: l.option.name,
    locationName: l.location.name,
    quantity: l.quantity,
  }))

  return NextResponse.json({
    negativeStockCount: negativeLevels.length,
    negativeSamples,
    pendingReconciliationCount,
  })
}
