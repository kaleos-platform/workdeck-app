import type { MetadataRoute } from 'next'
import { buildMarketingUrl } from '@/lib/domain'

/**
 * `/p/[uuid]`(공개 채용 공고 페이지)는 인증 없이 누구나 열람 가능한
 * 공개 콘텐츠(app/p/[uuid]/page.tsx 참고 — ACTIVE 상태만 공개, 무인증)이므로
 * 크롤 차단 대상이 아니다(allow). 지원 폼(`/p/[uuid]/apply`)만 별도 차단한다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/d/',
        '/my-deck',
        '/api/',
        '/auth/',
        '/oauth/',
        '/login',
        '/signup',
        '/space',
        '/settings',
        '/dashboard',
        '/workspace-setup',
        '/p/*/apply',
      ],
    },
    sitemap: buildMarketingUrl('/sitemap.xml'),
  }
}
