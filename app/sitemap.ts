import type { MetadataRoute } from 'next'
import { buildMarketingUrl } from '@/lib/domain'
import { MARKETING_DECK_SLUGS } from '@/lib/marketing/routes'
import { getAllPostSlugs } from '@/lib/marketing/blog'

/**
 * 마케팅 사이트 sitemap.
 * 블로그는 Phase 4 예정 — getAllPostSlugs()는 현재 빈 배열 반환(스텁),
 * 구현되면 이 파일 수정 없이 자동으로 항목이 추가된다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const home: MetadataRoute.Sitemap = [
    {
      url: buildMarketingUrl('/'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
  ]

  const decks: MetadataRoute.Sitemap = MARKETING_DECK_SLUGS.map((slug) => ({
    url: buildMarketingUrl(`/${slug}`),
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  const pricing: MetadataRoute.Sitemap = [
    {
      url: buildMarketingUrl('/pricing'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ]

  const about: MetadataRoute.Sitemap = [
    {
      url: buildMarketingUrl('/about'),
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: buildMarketingUrl('/contact'),
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]

  const legal: MetadataRoute.Sitemap = [
    {
      url: buildMarketingUrl('/terms'),
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: buildMarketingUrl('/privacy'),
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ]

  const blogPosts: MetadataRoute.Sitemap = getAllPostSlugs().map((slug) => ({
    url: buildMarketingUrl(`/blog/${slug}`),
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  return [...home, ...decks, ...pricing, ...about, ...legal, ...blogPosts]
}
