import type { Metadata } from 'next'
import { buildMarketingMetadata, orgJsonLd, websiteJsonLd } from '@/lib/marketing/seo'
import { JsonLd } from '@/components/marketing/json-ld'
import { HomeContent } from '@/components/marketing/home/home-content'
import { getReleasedDeckIds } from '@/lib/billing/deck-release'

export function generateMetadata(): Metadata {
  return buildMarketingMetadata({
    title: 'Workdeck — 여러 비즈니스 업무를 하나의 워크스페이스로',
    description:
      '쿠팡 광고 관리, 브랜드 운영, 재무 관리, 모집 관리, 세일즈 콘텐츠까지 — 필요한 업무만 골라 쓰는 올인원 비즈니스 워크스페이스, Workdeck.',
    path: '/',
    keywords: ['Workdeck', '비즈니스 워크스페이스', '이커머스 운영 툴', '쿠팡 광고 분석'],
  })
}

export default async function HomePage() {
  const releasedIds = await getReleasedDeckIds()
  return (
    <div className="w-full">
      <JsonLd data={orgJsonLd()} />
      <JsonLd data={websiteJsonLd()} />
      <HomeContent releasedIds={releasedIds} />
    </div>
  )
}
