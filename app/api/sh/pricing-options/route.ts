import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
// Decimal-like → number | null 변환 헬퍼
function dn(v: { toString(): string } | null | undefined): number | null {
  if (v == null) return null
  return Number(v.toString())
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()

  // 상품 단위 조회 — picker step1은 상품 목록이 필요(옵션 단위가 아님).
  // 옵션 단위로 페이지네이션하면 같은 상품 옵션이 page를 채워 상품이 일부만 노출됨.
  // spaceId 소속 검증 + 활성 옵션이 1건 이상 있는 상품만(가격그룹 step2 빈 화면 방지).
  const where: Record<string, unknown> = {
    spaceId: resolved.space.id,
    options: { some: { deletedAt: null } },
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { internalName: { contains: search, mode: 'insensitive' } },
      { options: { some: { name: { contains: search, mode: 'insensitive' } } } },
      { options: { some: { sku: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  const [products, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        msrp: true,
        brand: { select: { name: true } },
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  // picker step1 호환 shape — productId/productName 필수, 가격·옵션 상세는 step2에서 별도 로드.
  const data = products.map((p) => ({
    optionId: '', // step1 미사용 (가격그룹/옵션은 [productId]/options에서 로드)
    optionName: '',
    sku: null,
    productId: p.id,
    productName: p.name,
    brandName: p.brand?.name ?? null,
    costPrice: null,
    retailPrice: null,
    msrp: dn(p.msrp),
    totalStock: 0,
  }))

  return NextResponse.json({ data, total, page, pageSize })
}
