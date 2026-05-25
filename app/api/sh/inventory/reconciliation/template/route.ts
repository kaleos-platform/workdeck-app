import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/sh/inventory/reconciliation/template
// 재고 조정 파일 업로드용 7컬럼 long-format 사전 채움 데이터.
// 옵션 × 활성 위치 cross. externalCode 미매핑은 빈칸. 현재 stockLevel 없으면 0.
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const [locations, groups, mapItems] = await Promise.all([
    prisma.invStorageLocation.findMany({
      where: { spaceId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.invProductGroup.findMany({
      where: { spaceId },
      select: {
        id: true,
        name: true,
        products: {
          where: { spaceId },
          select: {
            id: true,
            name: true,
            internalName: true,
            brand: { select: { name: true } },
            options: {
              select: {
                id: true,
                name: true,
                stockLevels: { select: { locationId: true, quantity: true } },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.invLocationProductMapItem.findMany({
      where: { map: { spaceId } },
      select: {
        optionId: true,
        map: { select: { locationId: true, externalCode: true } },
      },
    }),
  ])

  // (optionId, locationId) → externalCode
  const externalCodeByOptLoc = new Map<string, string>()
  for (const it of mapItems) {
    const key = `${it.optionId}|${it.map.locationId}`
    if (!externalCodeByOptLoc.has(key)) externalCodeByOptLoc.set(key, it.map.externalCode)
  }

  type Row = {
    brandName: string
    productName: string
    optionName: string
    locationName: string
    externalCode: string
    currentQty: number
  }
  const rows: Row[] = []

  // 브랜드 → 상품 → 옵션 → 위치 순 cross
  type Item = {
    brandName: string
    productName: string
    optionId: string
    optionName: string
    qtyByLoc: Map<string, number>
  }
  const items: Item[] = []
  for (const g of groups) {
    for (const p of g.products) {
      for (const o of p.options) {
        const qtyByLoc = new Map<string, number>()
        for (const sl of o.stockLevels) qtyByLoc.set(sl.locationId, sl.quantity)
        items.push({
          brandName: p.brand?.name ?? '브랜드 없음',
          productName: p.internalName ?? p.name,
          optionId: o.id,
          optionName: o.name,
          qtyByLoc,
        })
      }
    }
  }
  items.sort((a, b) => {
    if (a.brandName !== b.brandName) return a.brandName.localeCompare(b.brandName)
    if (a.productName !== b.productName) return a.productName.localeCompare(b.productName)
    return a.optionName.localeCompare(b.optionName)
  })

  for (const it of items) {
    for (const loc of locations) {
      rows.push({
        brandName: it.brandName,
        productName: it.productName,
        optionName: it.optionName,
        locationName: loc.name,
        externalCode: externalCodeByOptLoc.get(`${it.optionId}|${loc.id}`) ?? '',
        currentQty: it.qtyByLoc.get(loc.id) ?? 0,
      })
    }
  }

  return NextResponse.json({ rows })
}
