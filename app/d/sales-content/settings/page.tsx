import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { SettingsTabsClient } from '@/components/sc/settings/settings-tabs-client'

// 서버 컴포넌트 — 모든 데이터를 병렬로 fetch 후 클라이언트 탭 컴포넌트에 전달
export default async function SettingsPage() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  const spaceId = resolved.space.id

  const [products, personas, brandProfile, channels, rules] = await Promise.all([
    prisma.b2BProduct.findMany({
      where: { spaceId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        oneLinerPitch: true,
        isActive: true,
        updatedAt: true,
      },
    }),
    prisma.persona.findMany({
      where: { spaceId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        jobTitle: true,
        industry: true,
        companySize: true,
        isActive: true,
        updatedAt: true,
      },
    }),
    prisma.brandProfile.findUnique({
      where: { spaceId },
    }),
    prisma.salesContentChannel.findMany({
      where: { spaceId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.improvementRule.findMany({
      where: { spaceId },
      orderBy: [{ status: 'asc' }, { weight: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        scope: true,
        source: true,
        title: true,
        body: true,
        status: true,
        weight: true,
        updatedAt: true,
      },
    }),
  ])

  // 브랜드 프로필 초기값 변환
  const brandProfileInitial = brandProfile
    ? {
        companyName: brandProfile.companyName,
        shortDescription: brandProfile.shortDescription ?? '',
        missionStatement: brandProfile.missionStatement ?? '',
        toneOfVoice: (brandProfile.toneOfVoice as string[] | null) ?? [],
        forbiddenPhrases: (brandProfile.forbiddenPhrases as string[] | null) ?? [],
        preferredPhrases: (brandProfile.preferredPhrases as string[] | null) ?? [],
        styleGuideUrl: brandProfile.styleGuideUrl ?? '',
        primaryColor: brandProfile.primaryColor ?? '',
        secondaryColor: brandProfile.secondaryColor ?? '',
        logoUrl: brandProfile.logoUrl ?? '',
      }
    : undefined

  return (
    <Suspense>
      <SettingsTabsClient
        products={products}
        personas={personas}
        brandProfileInitial={brandProfileInitial}
        channels={channels}
        rules={rules}
      />
    </Suspense>
  )
}
