import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { BrandProfileForm } from '@/components/sc/settings/brand-profile-form'

export default async function BrandProfilePage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const profile = await prisma.brandProfile.findUnique({
    where: { spaceId: resolved.space.id },
  })

  const initial = profile
    ? {
        companyName: profile.companyName,
        shortDescription: profile.shortDescription ?? '',
        missionStatement: profile.missionStatement ?? '',
        toneOfVoice: (profile.toneOfVoice as string[] | null) ?? [],
        forbiddenPhrases: (profile.forbiddenPhrases as string[] | null) ?? [],
        preferredPhrases: (profile.preferredPhrases as string[] | null) ?? [],
        styleGuideUrl: profile.styleGuideUrl ?? '',
        primaryColor: profile.primaryColor ?? '',
        secondaryColor: profile.secondaryColor ?? '',
        logoUrl: profile.logoUrl ?? '',
      }
    : undefined

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">브랜드 프로필</h1>
        <p className="text-sm text-muted-foreground">
          Space당 1개. 콘텐츠 톤·금칙어·비주얼 가이드의 단일 소스입니다.
        </p>
      </div>
      <BrandProfileForm initial={initial} />
    </div>
  )
}
