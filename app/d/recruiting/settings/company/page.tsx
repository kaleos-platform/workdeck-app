import { redirect } from 'next/navigation'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { CompanyProfileForm } from '@/components/hiring-posts/company-profile-form'

// 기업 정보 — 공개 공고 머리글·푸터에 표시할 값
export default async function CompanySettingsPage() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) redirect('/my-deck')

  const [profile, latestActive] = await Promise.all([
    prisma.hiringCompanyProfile.findUnique({
      where: { spaceId: resolved.space.id },
      select: {
        companyName: true,
        intro: true,
        homepageUrl: true,
        blogUrl: true,
        instagramUrl: true,
        youtubeUrl: true,
        showIntro: true,
      },
    }),
    prisma.hiringPosting.findFirst({
      where: { spaceId: resolved.space.id, status: 'ACTIVE' },
      orderBy: { publishedAt: 'desc' },
      select: { uuid: true },
    }),
  ])

  return (
    <CompanyProfileForm
      initialProfile={profile}
      defaultCompanyName={resolved.space.name}
      postingUuid={latestActive?.uuid ?? null}
    />
  )
}
