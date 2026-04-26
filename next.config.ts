import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  env: {
    // Expose Vercel's system URL so client code can detect preview deployments
    NEXT_PUBLIC_VERCEL_URL: process.env.VERCEL_URL ?? '',
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? '',
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
    ]
  },
}

export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  tunnelRoute: '/monitoring',
})
