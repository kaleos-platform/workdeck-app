import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productSchema } from '@/lib/sh/schemas'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    include: {
      brand: { select: { id: true, name: true } },
      options: {
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      },
    },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  return NextResponse.json({ product })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const existing = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productSchema.partial().safeParse(body)
  if (!parsed.success) {
    console.error('[products PATCH] invalid input', {
      productId,
      body,
      errors: parsed.error.flatten(),
    })
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { brandId, groupId } = parsed.data

  // brandId 소속 검증
  if (brandId) {
    const brand = await prisma.brand.findFirst({
      where: { id: brandId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!brand) return errorResponse('브랜드를 찾을 수 없습니다', 404)
  }

  // groupId 소속 검증
  if (groupId) {
    const group = await prisma.invProductGroup.findFirst({
      where: { id: groupId, spaceId: resolved.space.id },
      select: { id: true },
    })
    if (!group) return errorResponse('그룹을 찾을 수 없습니다', 404)
  }

  const {
    name,
    internalName,
    nameEn,
    code,
    status,
    manufacturer,
    manufactureCountry,
    manufactureDate,
    features,
    certifications,
    msrp,
    description,
    optionAttributes,
  } = parsed.data

  try {
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.invProduct.update({
        where: { id: productId },
        data: {
          ...(name !== undefined && { name }),
          ...(internalName !== undefined && { internalName: internalName ?? null }),
          ...(nameEn !== undefined && { nameEn: nameEn ?? null }),
          ...(code !== undefined && { code: code ?? null }),
          ...(status !== undefined && { status }),
          ...(brandId !== undefined && { brandId: brandId ?? null }),
          ...(groupId !== undefined && { groupId }),
          ...(manufacturer !== undefined && { manufacturer: manufacturer ?? null }),
          ...(manufactureCountry !== undefined && {
            manufactureCountry: manufactureCountry ?? null,
          }),
          ...(manufactureDate !== undefined && {
            manufactureDate: manufactureDate ? new Date(manufactureDate) : null,
          }),
          ...(features !== undefined && { features }),
          ...(certifications !== undefined && { certifications }),
          ...(msrp !== undefined && { msrp: msrp ?? null }),
          ...(description !== undefined && { description: description ?? null }),
          ...(optionAttributes !== undefined && { optionAttributes }),
        },
        include: {
          brand: { select: { id: true, name: true } },
          options: true,
        },
      })

      // Space 커스텀 사전 자동 학습
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

      return updated
    })

    return NextResponse.json({ product })
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    const target = (err as { meta?: { target?: string[] } })?.meta?.target
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[products PATCH] update failed', { productId, code, target, detail })
    if (code === 'P2002') {
      const targets = Array.isArray(target) ? target : []
      let message = '이미 동일한 값이 존재합니다'
      if (targets.includes('name')) message = '이미 같은 상품명이 존재합니다'
      else if (targets.includes('code')) message = '이미 같은 상품 코드가 존재합니다'
      return errorResponse(message, 409, { detail, target: targets })
    }
    if (code === 'P2003') {
      return errorResponse('연결된 데이터를 찾을 수 없습니다 (foreign key)', 400, { detail })
    }
    return errorResponse('상품 저장 중 오류가 발생했습니다', 500, { detail })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const existing = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!existing) return errorResponse('상품을 찾을 수 없습니다', 404)

  if (existing.status !== 'INACTIVE') {
    return errorResponse('상품을 미사용 처리한 뒤 삭제할 수 있습니다', 409)
  }

  try {
    await prisma.invProduct.delete({ where: { id: productId } })
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    const detail = err instanceof Error ? err.message : String(err)
    if (code === 'P2003') {
      return errorResponse('연결된 데이터가 있어 삭제할 수 없습니다', 409, { detail })
    }
    return errorResponse('상품 삭제 중 오류가 발생했습니다', 500, { detail })
  }

  return new NextResponse(null, { status: 204 })
}
