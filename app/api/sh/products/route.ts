import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/sh/schemas'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))
  const search = (searchParams.get('search') ?? '').trim()
  const brandId = searchParams.get('brandId')
  const groupId = searchParams.get('groupId')

  const where: Record<string, unknown> = { spaceId: resolved.space.id }
  if (brandId) where.brandId = brandId
  if (groupId === 'none') where.groupId = null
  else if (groupId) where.groupId = groupId

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { nameEn: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [products, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        brand: { select: { id: true, name: true } },
        options: true,
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  return NextResponse.json({ data: products, total, page, pageSize })
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
    nameEn,
    code,
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

  const product = await prisma.invProduct.create({
    data: {
      spaceId: resolved.space.id,
      name,
      nameEn: nameEn ?? null,
      code: code ?? null,
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
    include: {
      brand: { select: { id: true, name: true } },
      options: true,
    },
  })

  return NextResponse.json({ product }, { status: 201 })
}
