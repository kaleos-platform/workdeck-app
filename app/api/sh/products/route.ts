import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/sh/schemas'
import { productSearchFilter } from '@/lib/sh/product-search'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()
  const brandId = searchParams.get('brandId')
  const groupId = searchParams.get('groupId')
  const statusParam = searchParams.get('status') ?? 'ACTIVE'

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (statusParam === 'ACTIVE' || statusParam === 'INACTIVE') {
    where.status = statusParam
  } else if (statusParam !== 'all') {
    where.status = 'ACTIVE'
  }
  if (brandId) where.brandId = brandId
  if (groupId === 'none') where.groupId = null
  else if (groupId) where.groupId = groupId

  // tokenized=1이면 파일 상품명 등 검증된 규칙(tokenizeProductName)으로 토큰을 쪼갠다.
  // 기본은 공백 분리 — 'BLK-S' 같은 정확 검색어가 과분리되지 않도록.
  const tokenized = searchParams.get('tokenized') === '1'

  const searchFilter = productSearchFilter(search, { aggressive: tokenized })
  if (searchFilter) {
    Object.assign(where, searchFilter)
  }

  const [products, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      // 화면 표시명(productDisplayName)은 관리명(internalName) 우선이므로 정렬도 동일 기준으로 맞춘다.
      // id 타이브레이크는 페이지네이션 중복/누락 방지용.
      orderBy: [{ internalName: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        brand: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        options: {
          where: { deletedAt: null },
          select: { id: true, name: true, sku: true, retailPrice: true },
        },
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  // 옵션별 totalStock 집계 — invStockLevel.quantity 합계
  const optionIds = products.flatMap((p) => p.options.map((o) => o.id))
  const stockByOption = new Map<string, number>()
  if (optionIds.length > 0) {
    const stockRows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of stockRows) {
      stockByOption.set(r.optionId, r._sum.quantity ?? 0)
    }
  }

  const data = products.map((p) => ({
    ...p,
    options: p.options.map((o) => ({ ...o, totalStock: stockByOption.get(o.id) ?? 0 })),
  }))

  return NextResponse.json({ data, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const {
    name,
    internalName,
    nameEn,
    code,
    status,
    brandId,
    groupId,
    manufacturer,
    manufactureCountry,
    manufactureDate,
    features,
    certifications,
    msrp,
    description,
    optionAttributes,
    options,
  } = parsed.data

  // brandId 소속 검증
  if (brandId) {
    const brand = await prisma.brand.findFirst({
      where: { id: brandId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!brand) return errorResponse('브랜드를 찾을 수 없습니다', 404)
  }

  // groupId(카테고리) 소속 검증 — 필수 필드
  const group = await prisma.invProductGroup.findFirst({
    where: { id: groupId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!group) return errorResponse('카테고리를 찾을 수 없습니다', 404)

  // 옵션 미전송 시 기본 옵션 1건 자동 생성 — 빈 상품이 만들어지지 않도록 안전망
  const optionsToCreate =
    options && options.length > 0
      ? options
      : ([{ name: '기본' }] as typeof options & NonNullable<typeof options>)

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.invProduct.create({
      data: {
        spaceId: resolved.space.id,
        name,
        internalName: internalName ?? null,
        nameEn: nameEn ?? null,
        code: code ?? null,
        status: status ?? 'ACTIVE',
        brandId: brandId ?? null,
        groupId,
        manufacturer: manufacturer ?? null,
        manufactureCountry: manufactureCountry ?? null,
        manufactureDate: manufactureDate ? new Date(manufactureDate) : null,
        features: features ?? undefined,
        certifications: certifications ?? undefined,
        msrp: msrp ?? null,
        description: description ?? null,
        optionAttributes: optionAttributes ?? undefined,
      },
    })

    await tx.invProductOption.createMany({
      data: optionsToCreate.map((o) => ({
        productId: created.id,
        name: o.name,
        sku: o.sku ?? null,
        costPrice: o.costPrice ?? null,
        retailPrice: o.retailPrice ?? null,
        sizeLabel: o.sizeLabel ?? null,
        setSizeLabel: o.setSizeLabel ?? null,
        attributeValues: o.attributeValues ?? undefined,
      })),
    })

    // Space 커스텀 사전 자동 학습 — 사용자가 입력한 값-코드를 Space alias에 upsert
    if (optionAttributes && Array.isArray(optionAttributes)) {
      for (const attr of optionAttributes) {
        if (!attr?.name?.trim() || !Array.isArray(attr.values)) continue
        for (const v of attr.values) {
          const value = String(v?.value ?? '').trim()
          const code = String(v?.code ?? '').trim()
          if (!value || !code) continue
          await tx.spaceOptionCodeAlias.upsert({
            where: {
              spaceId_attributeName_value: {
                spaceId: resolved.space.id,
                attributeName: attr.name.trim(),
                value,
              },
            },
            create: {
              spaceId: resolved.space.id,
              attributeName: attr.name.trim(),
              value,
              code,
            },
            update: { code },
          })
        }
      }
    }

    return tx.invProduct.findUnique({
      where: { id: created.id },
      include: {
        brand: { select: { id: true, name: true } },
        options: true,
      },
    })
  })

  return NextResponse.json({ product }, { status: 201 })
}
