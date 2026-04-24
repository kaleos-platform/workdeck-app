import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { DelFieldMapping } from '@/lib/del/format-templates'

type Params = { params: Promise<{ methodId: string }> }

/**
 * 배송 방식의 옵션별 오버라이드 라벨 목록.
 * 스페이스 내 모든 옵션을 기준으로 조회하되, 해당 배송방식의 overrides(있다면)와 함께 반환.
 * 대량일 수 있으므로 paginate + 상품/옵션명 검색 지원.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { methodId } = await params

  const method = await prisma.delShippingMethod.findFirst({
    where: { id: methodId, spaceId: resolved.space.id },
    select: { id: true, name: true, formatConfig: true },
  })
  if (!method) return errorResponse('배송 방식을 찾을 수 없습니다', 404)

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()
  const brandId = searchParams.get('brandId')

  const productWhere: Record<string, unknown> = { spaceId: resolved.space.id }
  if (brandId && brandId !== 'all') {
    productWhere.brandId = brandId === 'none' ? null : brandId
  }
  if (search) {
    // 검색은 관리 상품명(internalName) 기준 — 공식명(name) 제외
    productWhere.OR = [
      { internalName: { contains: search, mode: 'insensitive' } },
      { nameEn: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { options: { some: { name: { contains: search, mode: 'insensitive' } } } },
      { options: { some: { sku: { contains: search, mode: 'insensitive' } } } },
    ]
  }

  const [products, total] = await Promise.all([
    prisma.invProduct.findMany({
      where: productWhere,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        internalName: true,
        code: true,
        brand: { select: { id: true, name: true } },
        options: { select: { id: true, name: true, sku: true } },
      },
    }),
    prisma.invProduct.count({ where: productWhere }),
  ])

  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))
  const labels = optionIds.length
    ? await prisma.delShippingMethodLabel.findMany({
        where: { shippingMethodId: methodId, optionId: { in: optionIds } },
        select: { optionId: true, overrides: true, updatedAt: true },
      })
    : []
  const overridesByOption = new Map<
    string,
    { overrides: Partial<Record<DelFieldMapping, string>>; updatedAt: Date }
  >()
  for (const l of labels) {
    overridesByOption.set(l.optionId, {
      overrides: (l.overrides as Partial<Record<DelFieldMapping, string>>) ?? {},
      updatedAt: l.updatedAt,
    })
  }

  const rows = products.flatMap((p) => {
    // 내부 표시용 — 관리명 우선, 없으면 공식명
    const internal = p.internalName?.trim()
    const productName = internal && internal.length > 0 ? internal : p.name
    return p.options.map((o) => {
      const entry = overridesByOption.get(o.id)
      return {
        productId: p.id,
        productName,
        productOfficialName: p.name, // 공식명 원본 (UI에서 힌트로 필요시 표시)
        productCode: p.code,
        brandName: p.brand?.name ?? null,
        optionId: o.id,
        optionName: o.name,
        sku: o.sku,
        overrides: entry?.overrides ?? {},
        updatedAt: entry?.updatedAt ?? null,
      }
    })
  })

  return NextResponse.json({
    method: { id: method.id, name: method.name, formatConfig: method.formatConfig },
    data: rows,
    total,
    page,
    pageSize,
  })
}
