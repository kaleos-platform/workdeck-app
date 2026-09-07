import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { OnboardingWizard } from '@/components/sc/onboarding/onboarding-wizard'
import type { OnboardingDraft } from '@/lib/sc/onboarding/schemas'

// 서버 컴포넌트 — 위저드 초기 데이터를 병렬로 fetch 후 클라이언트 위저드에 주입
export default async function OnboardingPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const spaceId = resolved.space.id

  const [brandProfile, productCount, personaCount, channelCount, resources, onboarding] =
    await Promise.all([
      prisma.brandProfile.findUnique({ where: { spaceId } }),
      prisma.product.count({ where: { spaceId, isActive: true } }),
      prisma.persona.count({ where: { spaceId, isActive: true } }),
      prisma.salesContentChannel.count({ where: { spaceId } }),
      prisma.scOnboardingResource.findMany({
        where: { spaceId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          kind: true,
          sourceUrl: true,
          fileName: true,
          mimeType: true,
          status: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
      prisma.salesContentOnboarding.findUnique({ where: { spaceId } }),
    ])

  const brandProfileInitial = brandProfile
    ? {
        companyName: brandProfile.companyName,
        shortDescription: brandProfile.shortDescription ?? '',
        toneOfVoice: (brandProfile.toneOfVoice as string[] | null) ?? [],
      }
    : null

  return (
    <OnboardingWizard
      brandProfile={brandProfileInitial}
      logoUrl={brandProfile?.logoUrl ?? null}
      productCount={productCount}
      personaCount={personaCount}
      channelCount={channelCount}
      resources={resources.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      draft={(onboarding?.draft as OnboardingDraft | null) ?? null}
      draftStatus={onboarding?.draftStatus ?? null}
    />
  )
}
