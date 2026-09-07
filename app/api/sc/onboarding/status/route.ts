import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { onboardingStatusPatchSchema } from '@/lib/sc/onboarding/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const [brandProfile, productCount, personaCount, channelCount, resourceCount, onboarding] =
    await Promise.all([
      prisma.brandProfile.count({ where: { spaceId } }),
      prisma.product.count({ where: { spaceId, isActive: true } }),
      prisma.persona.count({ where: { spaceId, isActive: true } }),
      prisma.salesContentChannel.count({ where: { spaceId } }),
      prisma.scOnboardingResource.count({ where: { spaceId } }),
      prisma.salesContentOnboarding.findUnique({ where: { spaceId } }),
    ])

  return NextResponse.json({
    counts: {
      brandProfile,
      products: productCount,
      personas: personaCount,
      channels: channelCount,
      resources: resourceCount,
    },
    completed: onboarding?.completedAt != null,
    dismissed: onboarding?.dismissedAt != null,
    draftStatus: onboarding?.draftStatus ?? null,
    draft: onboarding?.draft ?? null,
  })
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = onboardingStatusPatchSchema.safeParse(body)
  if (!parsed.success) return errorResponse('dismissed 또는 completed만 허용합니다', 400)

  const now = new Date()
  const data: { dismissedAt?: Date; completedAt?: Date } = {}
  if (parsed.data.dismissed) data.dismissedAt = now
  if (parsed.data.completed) data.completedAt = now

  const onboarding = await prisma.salesContentOnboarding.upsert({
    where: { spaceId },
    create: { spaceId, ...data },
    update: data,
  })

  return NextResponse.json({
    completed: onboarding.completedAt != null,
    dismissed: onboarding.dismissedAt != null,
  })
}
