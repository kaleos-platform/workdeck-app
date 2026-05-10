import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)

  // 위치 목록
  const locations = await prisma.invStorageLocation.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  // 최근 7일 OUTBOUND 집계 (optionId 기준)
  const outboundAgg = await prisma.invMovement.groupBy({
    by: ['optionId'],
    where: { spaceId, type: 'OUTBOUND', movementDate: { gte: since } },
    _sum: { quantity: true },
  })
  const outboundByOption = new Map(
    outboundAgg.map((a) => [a.optionId, Math.abs(a._sum.quantity ?? 0)])
  )

  // 그룹 → 상품 → 옵션 계층 조회
  const groups = await prisma.invProductGroup.findMany({
    where: { spaceId },
    select: {
      id: true,
      name: true,
      products: {
        where: { spaceId },
        select: {
          id: true,
          name: true,
          code: true,
          options: {
            select: {
              id: true,
              name: true,
              sku: true,
              stockLevels: {
                select: { locationId: true, quantity: true },
              },
            },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  const shaped = groups.map((g) => ({
    groupId: g.id,
    groupName: g.name,
    products: g.products.map((p) => ({
      productId: p.id,
      productName: p.name,
      productCode: p.code ?? null,
      options: p.options.map((o) => {
        const stockByLocation = o.stockLevels.map((sl) => ({
          locationId: sl.locationId,
          locationName: locations.find((l) => l.id === sl.locationId)?.name ?? '(알 수 없음)',
          quantity: sl.quantity,
        }))
        const totalStock = o.stockLevels.reduce((sum, sl) => sum + sl.quantity, 0)
        return {
          optionId: o.id,
          optionName: o.name,
          sku: o.sku ?? null,
          stockByLocation,
          totalStock,
          outbound7d: outboundByOption.get(o.id) ?? 0,
        }
      }),
    })),
  }))

  return NextResponse.json({ groups: shaped, locations })
}
