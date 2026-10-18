import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { brandProfileSchema } from '@/lib/sc/schemas'
import { isSpaceBrand, saveBrandProfileNow } from '@/lib/sc/brand-profile'

// brandId 없음/빈 값 = Space 공통 프로필
const brandIdSchema = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((v) => v || null)

// 편집 화면용 — 공통으로 폴백하지 않고 그 브랜드의 프로필만 돌려준다.
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const brandId = brandIdSchema.safeParse(req.nextUrl.searchParams.get('brandId'))
  if (!brandId.success) return errorResponse('잘못된 브랜드입니다', 400)
  const profile = await prisma.brandProfile.findFirst({
    where: { spaceId: resolved.space.id, brandId: brandId.data },
  })

  return NextResponse.json({ profile })
}

export async function PUT(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content', { write: true })
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = brandProfileSchema.extend({ brandId: brandIdSchema }).safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { brandId, ...d } = parsed.data
  if (brandId && !(await isSpaceBrand(resolved.space.id, brandId))) {
    return errorResponse('브랜드를 찾을 수 없습니다', 404)
  }

  const profile = await saveBrandProfileNow(resolved.space.id, brandId, {
    companyName: d.companyName,
    shortDescription: d.shortDescription ?? null,
    toneOfVoice: d.toneOfVoice ?? undefined,
    customFields: (d.customFields ?? []) as never,
  })

  return NextResponse.json({ profile })
}
