import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { brandProfileSchema } from '@/lib/sc/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const profile = await prisma.brandProfile.findUnique({
    where: { spaceId: resolved.space.id },
  })

  return NextResponse.json({ profile })
}

export async function PUT(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = brandProfileSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const d = parsed.data

  const profile = await prisma.brandProfile.upsert({
    where: { spaceId: resolved.space.id },
    create: {
      spaceId: resolved.space.id,
      companyName: d.companyName,
      shortDescription: d.shortDescription ?? null,
      missionStatement: d.missionStatement ?? null,
      toneOfVoice: d.toneOfVoice ?? undefined,
      forbiddenPhrases: d.forbiddenPhrases ?? undefined,
      preferredPhrases: d.preferredPhrases ?? undefined,
      styleGuideUrl: d.styleGuideUrl ?? null,
      primaryColor: d.primaryColor ?? null,
      secondaryColor: d.secondaryColor ?? null,
      logoUrl: d.logoUrl ?? null,
    },
    update: {
      companyName: d.companyName,
      shortDescription: d.shortDescription ?? null,
      missionStatement: d.missionStatement ?? null,
      toneOfVoice: d.toneOfVoice ?? undefined,
      forbiddenPhrases: d.forbiddenPhrases ?? undefined,
      preferredPhrases: d.preferredPhrases ?? undefined,
      styleGuideUrl: d.styleGuideUrl ?? null,
      primaryColor: d.primaryColor ?? null,
      secondaryColor: d.secondaryColor ?? null,
      logoUrl: d.logoUrl ?? null,
    },
  })

  return NextResponse.json({ profile })
}
