import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // 직접 관리하는 AGENTS.md에 개발 서버가 규칙을 자동 추가하지 않도록 한다.
  agentRules: false,
  // 라이브 작업대: tailnet 주소로 여는 dev 서버의 HMR·리소스 요청을 허용한다.
  allowedDevOrigins: ['100.77.48.94', 'kaleos-macmini', '*.ts.net'],
  env: {
    // Expose Vercel's system URL so client code can detect preview deployments
    NEXT_PUBLIC_VERCEL_URL: process.env.VERCEL_URL ?? '',
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? '',
  },
  // 운영자 어드민 도메인은 검색 색인 대상이 아니다. robots.txt Disallow 대신 noindex 헤더를 쓴다 —
  // 크롤링을 막으면 구글이 noindex 를 못 봐서 이미 발견한 로그인 URL 이 「중복 페이지」로 남는다(GSC 2026-11-26).
  async headers() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'admin.workdeck.work' }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ]
  },
  async redirects() {
    return [
      // inventory-mgmt → seller-hub/inventory
      { source: '/d/inventory-mgmt', destination: '/d/seller-ops/inventory', permanent: true },
      {
        source: '/d/inventory-mgmt/stock-status',
        destination: '/d/seller-ops/inventory/stock-status',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/movements',
        destination: '/d/seller-ops/inventory/movements',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/locations',
        destination: '/d/seller-ops/inventory/locations',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/reconciliation',
        destination: '/d/seller-ops/inventory/reconciliation',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/reorder',
        destination: '/d/seller-ops/inventory/reorder',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/settings',
        destination: '/d/seller-ops/settings',
        permanent: true,
      },
      // 상품/채널은 seller-hub 도메인으로 이동
      {
        source: '/d/inventory-mgmt/products',
        destination: '/d/seller-ops/products/list',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/channels',
        destination: '/d/seller-ops/channels',
        permanent: true,
      },
      // delivery-mgmt → seller-hub/shipping
      { source: '/d/delivery-mgmt', destination: '/d/seller-ops/shipping', permanent: true },
      {
        source: '/d/delivery-mgmt/registration',
        destination: '/d/seller-ops/shipping/registration',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/orders',
        destination: '/d/seller-ops/shipping/orders',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/integration',
        destination: '/d/seller-ops/shipping/integration',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/channels',
        destination: '/d/seller-ops/channels',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/shipping',
        destination: '/d/seller-ops/shipping/methods',
        permanent: true,
      },
      // 레거시 seller-hub URL 호환 — 북마크 안전
      {
        source: '/d/seller-hub',
        destination: '/d/seller-ops',
        permanent: true,
      },
      {
        source: '/d/seller-hub/:path*',
        destination: '/d/seller-ops/:path*',
        permanent: true,
      },
      // blog-ops 폐기 (2026-08) — 앱 진입은 내 워크덱으로, 랜딩은 세일즈 콘텐츠로
      { source: '/d/blog-ops', destination: '/my-deck', permanent: true },
      { source: '/d/blog-ops/:path*', destination: '/my-deck', permanent: true },
      { source: '/blog-ops', destination: '/sales-content', permanent: true },
      // 오프닝워크 소개 사이트(Webflow) 이전 (2026-11) — 모든 경로를 모집 관리 랜딩으로
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'welcome.opening.work' }],
        destination: 'https://workdeck.work/recruiting?utm_source=opening&utm_medium=redirect',
        permanent: true,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  tunnelRoute: '/monitoring',
  sourcemaps: {
    // 기본 목록(static/chunks)은 Vercel 의 static/immutable/chunks 를 놓친다.
    // 지정하면 기본 목록을 통째로 대체하므로 서버 경로도 함께 둔다(CLI 직접 전달, glob 미지원).
    assets: ['.next/server', '.next/static'],
    deleteSourcemapsAfterUpload: true,
  },
})
