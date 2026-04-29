import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const source = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    include: { options: true },
  })
  if (!source) return errorResponse('상품을 찾을 수 없습니다', 404)

  const duplicated = await prisma.$transaction(async (tx) => {
    const created = await tx.invProduct.create({
      data: {
        spaceId: source.spaceId,
        name: `${source.name} (복사)`,
        internalName: source.internalName,
        nameEn: source.nameEn,
        code: null,
        brandId: source.brandId,
        groupId: source.groupId,
        manufacturer: source.manufacturer,
        manufactureCountry: source.manufactureCountry,
        manufactureDate: source.manufactureDate,
        features: source.features ?? undefined,
        certifications: source.certifications ?? undefined,
        msrp: source.msrp,
        description: source.description,
        optionAttributes: source.optionAttributes ?? undefined,
      },
    })

    if (source.options.length > 0) {
      await tx.invProductOption.createMany({
        data: source.options.map((o) => ({
          productId: created.id,
          name: o.name,
          sku: null,
          costPrice: o.costPrice,
          retailPrice: o.retailPrice,
          sizeLabel: o.sizeLabel,
          setSizeLabel: o.setSizeLabel,
          attributeValues: o.attributeValues ?? undefined,
        })),
      })
    }

    return created
  })

  return NextResponse.json({ product: duplicated }, { status: 201 })
}
