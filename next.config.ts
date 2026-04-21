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
      { source: '/d/inventory-mgmt', destination: '/d/seller-hub/inventory', permanent: true },
      {
        source: '/d/inventory-mgmt/stock-status',
        destination: '/d/seller-hub/inventory/stock-status',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/movements',
        destination: '/d/seller-hub/inventory/movements',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/locations',
        destination: '/d/seller-hub/inventory/locations',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/reconciliation',
        destination: '/d/seller-hub/inventory/reconciliation',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/reorder',
        destination: '/d/seller-hub/inventory/reorder',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/settings',
        destination: '/d/seller-hub/settings',
        permanent: true,
      },
      // 상품/채널은 seller-hub 도메인으로 이동
      {
        source: '/d/inventory-mgmt/products',
        destination: '/d/seller-hub/products/list',
        permanent: true,
      },
      {
        source: '/d/inventory-mgmt/channels',
        destination: '/d/seller-hub/channels',
        permanent: true,
      },
      // delivery-mgmt → seller-hub/shipping
      { source: '/d/delivery-mgmt', destination: '/d/seller-hub/shipping', permanent: true },
      {
        source: '/d/delivery-mgmt/registration',
        destination: '/d/seller-hub/shipping/registration',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/orders',
        destination: '/d/seller-hub/shipping/orders',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/integration',
        destination: '/d/seller-hub/shipping/integration',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/channels',
        destination: '/d/seller-hub/channels',
        permanent: true,
      },
      {
        source: '/d/delivery-mgmt/shipping',
        destination: '/d/seller-hub/shipping/methods',
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
