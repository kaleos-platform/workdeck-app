import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/sh/inventory/reconciliation/template
// 재고 조정 파일 업로드용 빈 양식. 옵션 1개당 1행, 위치명/실재고는 빈칸으로 사용자가 채움.
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const groups = await prisma.invProductGroup.findMany({
    where: { spaceId },
    select: {
      id: true,
      products: {
        where: { spaceId },
        select: {
          id: true,
          name: true,
          internalName: true,
          brand: { select: { name: true } },
          options: {
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  })

  type Row = { brandName: string; productName: string; optionName: string }
  const rows: Row[] = []
  for (const g of groups) {
    for (const p of g.products) {
      for (const o of p.options) {
        rows.push({
          brandName: p.brand?.name ?? '브랜드 없음',
          productName: p.internalName ?? p.name,
          optionName: o.name,
        })
      }
    }
  }
  rows.sort((a, b) => {
    if (a.brandName !== b.brandName) return a.brandName.localeCompare(b.brandName)
    if (a.productName !== b.productName) return a.productName.localeCompare(b.productName)
    return a.optionName.localeCompare(b.optionName)
  })

  return NextResponse.json({ rows })
}
